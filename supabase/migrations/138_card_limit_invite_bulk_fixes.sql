-- ============================================================================
-- 138: Two card-limit follow-ups surfaced by the mig 136/137 audit.
--
-- M1 — accept_invite (private invite) subscribe branch bypassed the owned-card cap.
--   acquire_listing's subscribe branch enforces check_card_limit (mig 118), but the
--   private-invite path never did — a subscriber could accept an arbitrarily large
--   non-official deck and blow past their cap (study-access only; the cards stay
--   publisher-owned). The mig-136 trigger cannot backstop this: subscribing writes
--   deck_shares + user_card_progress, never `cards`. Fix here: pre-check the cap in
--   accept_invite BEFORE the share is flipped to active (else _owned_card_count, which
--   counts active subscribe shares, would already include it and self-block).
--
-- L5 — bulk_insert_cards inserted one row per loop iteration → the mig-136
--   FOR-EACH-STATEMENT trigger fired N times, each running the bounded over-cap probe
--   (O(cap) each) — O(cap × N) redundant work / a direct-RPC DoS surface. Rewrite as a
--   single set-based INSERT..SELECT so the trigger fires exactly ONCE per call. The
--   up-front check_card_limit(full batch) still does the enforcement; behaviour and
--   sort-position ordering are preserved.
--
-- (116 and 099 are SHIPPED — replaced here via a forward migration, not edited in place.)
-- Idempotent: CREATE OR REPLACE only.
-- ============================================================================

-- ── M1: accept_invite — cap the subscribe branch ────────────────────────────
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
  v_add_count integer;   -- mig 138: non-official cards a subscribe accept would add
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

  -- ★ mig 138: owned-card cap for the SUBSCRIBE path — enforce BEFORE activating the
  -- share (once active, _owned_card_count would already include these cards). Mirrors
  -- acquire_listing (mig 118). The COPY/snapshot path is guarded inside
  -- copy_deck_for_user, so only subscribe needs a pre-check here.
  IF v_share.share_mode = 'subscribe' THEN
    SELECT count(*)::int INTO v_add_count
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.id = v_share.deck_id
      AND (
        (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
        OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
      );
    PERFORM check_card_limit(v_uid, v_add_count);  -- raises PT402 / CARD_LIMIT_REACHED if over
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
GRANT  EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;

-- ── L5: bulk_insert_cards — single set-based INSERT (trigger fires once) ─────
CREATE OR REPLACE FUNCTION public.bulk_insert_cards(
  p_deck_id UUID,
  p_template_id UUID,
  p_cards JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_position INTEGER;
  v_inserted INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Deck not found or not owned by user';
  END IF;

  -- Owned-card limit (mig 116): whole-batch pre-check.
  PERFORM public.check_card_limit(v_user_id, jsonb_array_length(p_cards));

  SELECT next_position INTO v_position FROM decks WHERE id = p_deck_id;

  -- Single set-based insert — one statement → the mig-136 AFTER-STATEMENT trigger fires
  -- exactly once. WITH ORDINALITY preserves input order into sort_position.
  WITH items AS (
    SELECT elem, (ord - 1) AS idx
    FROM jsonb_array_elements(p_cards) WITH ORDINALITY AS t(elem, ord)
  )
  INSERT INTO cards (deck_id, user_id, template_id, field_values, tags, sort_position)
  SELECT
    p_deck_id,
    v_user_id,
    p_template_id,
    COALESCE(elem->'field_values', '{}'::jsonb),
    COALESCE(
      (SELECT array_agg(x.value::text) FROM jsonb_array_elements_text(elem->'tags') AS x(value)),
      '{}'::text[]
    ),
    v_position + idx
  FROM items;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE decks
  SET next_position = v_position + v_inserted,
      updated_at = NOW()
  WHERE id = p_deck_id;

  RETURN jsonb_build_object('inserted', v_inserted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_insert_cards(UUID, UUID, JSONB) TO authenticated;
