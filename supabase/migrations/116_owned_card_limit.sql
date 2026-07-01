-- ============================================================================
-- 116: Owned-card ownership limit (Phase 1).
--
-- Model: an account may OWN up to N study cards (default 1000). Cards in OFFICIAL
-- CERTIFIED decks are EXCLUDED from the count. At the cap, ALL new card creation is
-- blocked server-side (manual add, Quick Create, AI-generate persist, REST API,
-- deck copy/import) until the user subscribes. Subscription unlock = PHASE 2 (a
-- one-line change in check_card_limit — the seam is stubbed below, NOT built here).
--
-- Extensible: the limit AND the official-exclusion are CONFIG (card_limit_settings),
-- so both are tuned by a single DB UPDATE — no migration, no redeploy:
--     UPDATE card_limit_settings SET max_owned_cards = 3000;              -- change cap
--     UPDATE card_limit_settings SET count_official_cards = true;         -- include official
--
-- Enforcement is centralized in check_card_limit(), called from the 3 SECURITY
-- DEFINER RPCs that gate every insert path (reserve_card_positions covers manual /
-- Quick Create / AI-persist / REST API; copy_deck_for_user covers invite+marketplace
-- copies; bulk_insert_cards covers CSV import) + an up-front pre-check in the
-- ai-generate edge fn (so AI credits are not spent on cards that can't be saved).
--
-- Idempotent/additive: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── Config (DB-UPDATE tunable) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.card_limit_settings (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_owned_cards       integer NOT NULL DEFAULT 1000,
  count_official_cards  boolean NOT NULL DEFAULT false,  -- false = EXCLUDE official certified-deck cards
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.card_limit_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.card_limit_settings ENABLE ROW LEVEL SECURITY;
-- no policies → readable only by SECURITY DEFINER fns (run as definer) + service_role.

-- ── Count: a user's OWNED (decks.user_id = them) study cards, official excluded ──
-- decks.user_id is the ownership the create paths gate on, and it naturally excludes
-- SUBSCRIBED official decks (owned by the publisher/system user; the subscriber holds
-- only deck_shares + user_card_progress, zero owned `cards` rows). The manifest join
-- excludes OFFICIAL CERTIFIED decks; toggled off via count_official_cards.
-- NOTE: user COPIES of official decks DO count (new deck owned by the user, editable,
-- not in the manifest) — else the cap is trivially bypassed by copying a large deck.
CREATE OR REPLACE FUNCTION public._owned_card_count(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::int
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE d.user_id = p_owner
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_count(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._owned_card_limit()
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT max_owned_cards FROM card_limit_settings WHERE id = 1 $$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit() FROM PUBLIC, anon, authenticated;

-- ── Guard: raise if p_owner would exceed the cap by adding p_adding cards ──
-- errcode PT402 → PostgREST surfaces the direct .rpc() calls as HTTP 402; clients
-- also detect on error.hint = 'CARD_LIMIT_REACHED' (robust to PostgREST version).
CREATE OR REPLACE FUNCTION public.check_card_limit(p_owner uuid, p_adding integer)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owned integer;
  v_limit integer;
BEGIN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_adding IS NULL OR p_adding <= 0 THEN RETURN; END IF;

  -- Admins are never capped (mirrors the session-limit admin bypass). Keyed on the
  -- card OWNER so it holds for service_role-invoked paths too.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_owner AND role = 'admin') THEN RETURN; END IF;

  -- ── PHASE 2 SEAM — subscription unlock. Uncomment when payment/subscriptions live: ──
  -- IF EXISTS (SELECT 1 FROM subscriptions
  --            WHERE user_id = p_owner AND tier <> 'free'
  --              AND status IN ('active','trialing')) THEN RETURN; END IF;

  v_limit := public._owned_card_limit();
  -- serialize per-user so two concurrent creates into DIFFERENT decks can't both
  -- read (limit-1) and both pass. Cheap; released at txn end.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
  v_owned := public._owned_card_count(p_owner);
  IF v_owned + p_adding > v_limit THEN
    RAISE EXCEPTION 'card_limit_reached'
      USING errcode = 'PT402',
            hint    = 'CARD_LIMIT_REACHED',
            detail  = format('owned=%s adding=%s limit=%s', v_owned, p_adding, v_limit);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_card_limit(uuid, integer) FROM PUBLIC, anon, authenticated;
-- internal only: invoked by other SECURITY DEFINER fns (which run as definer), so no GRANT needed.

-- self-scoped wrapper (auth.uid, no IDOR param) for the AI edge pre-check + client pre-flight
CREATE OR REPLACE FUNCTION public.check_card_limit_self(p_adding integer)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.check_card_limit(auth.uid(), p_adding); END $$;
REVOKE EXECUTE ON FUNCTION public.check_card_limit_self(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.check_card_limit_self(integer) TO authenticated, service_role;

-- read-only usage for the UI meter (reuses _owned_card_count → meter & guard agree)
CREATE OR REPLACE FUNCTION public.get_owned_card_usage()
  RETURNS TABLE(owned integer, card_limit integer, available integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public._owned_card_count(auth.uid()),
         public._owned_card_limit(),
         greatest(public._owned_card_limit() - public._owned_card_count(auth.uid()), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_owned_card_usage() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_owned_card_usage() TO authenticated;

-- ── Wire the guard into every card-creation RPC (full-body CREATE OR REPLACE) ──

-- (1) reserve_card_positions — choke-point for manual add / Quick Create / bulk
--     import / AI-generate persist / REST API POST /decks/{id}/cards.
CREATE OR REPLACE FUNCTION public.reserve_card_positions(p_deck_id uuid, p_count integer)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_start integer;
  v_owner uuid;
BEGIN
  IF p_count IS NULL OR p_count <= 0 OR p_count > 100000 THEN
    RAISE EXCEPTION 'invalid count';
  END IF;

  -- Owned-card limit (mig 116): gate on the DECK OWNER's total BEFORE reserving,
  -- so a blocked create consumes no sort_position and inserts nothing. Skip when the
  -- deck is missing (owner NULL) — the UPDATE below raises the precise not-found error.
  SELECT user_id INTO v_owner FROM decks WHERE id = p_deck_id;
  IF v_owner IS NOT NULL THEN
    PERFORM public.check_card_limit(v_owner, p_count);
  END IF;

  UPDATE decks
     SET next_position = next_position + p_count,
         updated_at = now()
   WHERE id = p_deck_id
     AND (user_id = auth.uid() OR auth.role() = 'service_role')
  RETURNING next_position - p_count INTO v_start;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'deck not found or not owned';
  END IF;

  RETURN v_start;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_card_positions(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_card_positions(uuid, integer) TO authenticated, service_role;

-- (2) copy_deck_for_user — invite accept (copy/snapshot) + marketplace acquire (copy).
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

  -- Owned-card limit (mig 116): copies are user-owned cards → count. Block the whole
  -- copy if it would exceed the recipient's cap (all-or-nothing; no partial copy).
  PERFORM public.check_card_limit(p_recipient_id, (SELECT count(*)::int FROM cards WHERE deck_id = p_source_deck_id));

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

-- (3) bulk_insert_cards — CSV/JSON import RPC.
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
  v_card JSONB;
  v_inserted INTEGER := 0;
BEGIN
  -- Auth check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify deck ownership
  IF NOT EXISTS (
    SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Deck not found or not owned by user';
  END IF;

  -- Owned-card limit (mig 116)
  PERFORM public.check_card_limit(v_user_id, jsonb_array_length(p_cards));

  -- Get current next_position
  SELECT next_position INTO v_position FROM decks WHERE id = p_deck_id;

  -- Insert each card
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO cards (
      deck_id, user_id, template_id,
      field_values, tags, sort_position
    ) VALUES (
      p_deck_id,
      v_user_id,
      p_template_id,
      COALESCE(v_card->'field_values', '{}'::jsonb),
      COALESCE(
        (SELECT array_agg(t.value::text)
         FROM jsonb_array_elements_text(v_card->'tags') AS t(value)),
        '{}'::text[]
      ),
      v_position
    );

    v_position := v_position + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Update deck next_position
  UPDATE decks
  SET next_position = v_position,
      updated_at = NOW()
  WHERE id = p_deck_id;

  RETURN jsonb_build_object('inserted', v_inserted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_insert_cards(UUID, UUID, JSONB) TO authenticated;
