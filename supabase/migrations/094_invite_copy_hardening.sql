-- ============================================================================
-- 094: Close the two critical sharing holes found in the security audit.
--
--   (A) copy_deck_for_user had ZERO authorization — any caller could copy ANY
--       deck's full card content into their account (exfiltration) or plant
--       decks into another account (set p_recipient_id = victim). Add an
--       authorization guard: caller must be the recipient AND be entitled to the
--       source deck (owner / active-or-pending share / active listing).
--       service_role (Edge Functions) bypasses the guard.
--   (B) The deck_shares policy "Anyone can read pending invites by code" had a
--       qual that bound to NO caller-supplied code, so anon could enumerate
--       EVERY pending invite_code (a secret bearer token) + invite_email. The
--       client only ever needed to accept a single invite by its code, so we
--       move the whole accept server-side into accept_invite() (SECURITY DEFINER)
--       and DROP the over-broad policy.
--
-- accept_invite() claims the pending share (recipient = auth.uid(), active)
-- BEFORE calling copy_deck_for_user, so the new entitlement guard passes for the
-- legitimate accept path. acquire_listing already passes auth.uid() as recipient
-- against an active listing, so the marketplace path stays compatible.
-- ============================================================================

-- (A) Authorization guard on copy_deck_for_user. Body below is verbatim from the
--     live definition; only the guard block after BEGIN is new.
CREATE OR REPLACE FUNCTION public.copy_deck_for_user(p_source_deck_id uuid, p_recipient_id uuid, p_is_readonly boolean DEFAULT false, p_share_mode text DEFAULT 'copy'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_deck RECORD;
  v_new_deck_id UUID;
  v_new_template_id UUID;
BEGIN
  -- Authorization (skipped for service_role / internal Edge callers):
  -- the caller may only copy INTO their own account, and only FROM a deck they
  -- are entitled to (own it, have an active/pending share for it, or it is an
  -- active marketplace listing). Prevents private-deck exfiltration + injection.
  IF auth.role() <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required';
    END IF;
    IF p_recipient_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized recipient';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM decks WHERE id = p_source_deck_id AND user_id = auth.uid())
       AND NOT EXISTS (SELECT 1 FROM deck_shares WHERE deck_id = p_source_deck_id AND recipient_id = auth.uid() AND status IN ('active','pending'))
       AND NOT EXISTS (SELECT 1 FROM marketplace_listings WHERE deck_id = p_source_deck_id AND is_active = true) THEN
      RAISE EXCEPTION 'Access denied: not entitled to source deck';
    END IF;
  END IF;

  -- Get source deck
  SELECT * INTO v_source_deck FROM decks WHERE id = p_source_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source deck not found';
  END IF;

  -- Copy template if exists
  IF v_source_deck.default_template_id IS NOT NULL THEN
    INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, layout_mode, front_html, back_html, is_default)
    SELECT p_recipient_id, name, fields, front_layout, back_layout, layout_mode, front_html, back_html, false
    FROM card_templates WHERE id = v_source_deck.default_template_id
    RETURNING id INTO v_new_template_id;
  END IF;

  -- Copy deck
  INSERT INTO decks (
    user_id, name, description, color, icon, default_template_id,
    srs_settings, share_mode, source_deck_id, source_owner_id, is_readonly
  )
  VALUES (
    p_recipient_id, v_source_deck.name, v_source_deck.description,
    v_source_deck.color, v_source_deck.icon,
    COALESCE(v_new_template_id, v_source_deck.default_template_id),
    v_source_deck.srs_settings, p_share_mode, p_source_deck_id,
    v_source_deck.user_id, p_is_readonly
  )
  RETURNING id INTO v_new_deck_id;

  -- Copy cards
  INSERT INTO cards (
    deck_id, user_id, template_id, field_values, tags, sort_position,
    srs_status, ease_factor, interval_days, repetitions
  )
  SELECT
    v_new_deck_id, p_recipient_id,
    COALESCE(v_new_template_id, template_id),
    field_values, tags, sort_position,
    'new', 2.5, 0, 0
  FROM cards WHERE deck_id = p_source_deck_id;

  -- Update next_position on new deck
  UPDATE decks SET next_position = (
    SELECT COALESCE(MAX(sort_position) + 1, 0) FROM cards WHERE deck_id = v_new_deck_id
  ) WHERE id = v_new_deck_id;

  RETURN v_new_deck_id;
END;
$function$;

-- (B) Server-side invite acceptance. Does the entire accept atomically as the
--     authenticated caller, so the client never has to read deck_shares directly
--     (which is what forced the over-broad anon policy). Claims the share BEFORE
--     copying so copy_deck_for_user's entitlement check passes.
CREATE OR REPLACE FUNCTION public.accept_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_share deck_shares%ROWTYPE;
  v_new_deck_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_share
  FROM deck_shares
  WHERE invite_code = p_code AND status = 'pending'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'errors:sharing.invalidOrExpired';
  END IF;
  IF v_share.owner_id = v_uid THEN
    RAISE EXCEPTION 'errors:sharing.cannotAcceptOwn';
  END IF;

  -- Claim the invite for this user first (so the copy entitlement check passes).
  UPDATE deck_shares
  SET recipient_id = v_uid, status = 'active', accepted_at = now()
  WHERE id = v_share.id;

  IF v_share.share_mode = 'subscribe' THEN
    PERFORM init_subscriber_progress(v_uid, v_share.deck_id);
    RETURN jsonb_build_object('deck_id', v_share.deck_id);
  ELSE
    v_new_deck_id := copy_deck_for_user(
      v_share.deck_id, v_uid, (v_share.share_mode = 'snapshot'), v_share.share_mode
    );
    UPDATE deck_shares SET copied_deck_id = v_new_deck_id WHERE id = v_share.id;
    RETURN jsonb_build_object('deck_id', v_new_deck_id);
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;

-- (B) Drop the over-broad anon-readable pending-invite policy. The accept flow
--     now goes through accept_invite() (SECURITY DEFINER, reads the single row by
--     code internally), so no client ever needs blanket SELECT on pending shares.
DROP POLICY IF EXISTS "Anyone can read pending invites by code" ON public.deck_shares;
