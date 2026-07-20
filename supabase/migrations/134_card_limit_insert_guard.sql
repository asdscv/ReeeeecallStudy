-- ============================================================================
-- 134: HARD-ENFORCE the owned-card limit at the DB layer (defense-in-depth).
--
-- WHY. Until now the cap was enforced ONLY inside the SECURITY DEFINER insert RPCs
-- (reserve_card_positions / bulk_insert_cards / copy_deck_for_user / acquire_listing).
-- But the cards RLS policy is `FOR ALL USING (auth.uid() = user_id)` with no separate
-- WITH CHECK (mig 001:154), so a logged-in user can POST /rest/v1/cards (single row or
-- array) directly and NEVER call reserve_card_positions → the cap is bypassed. The web
-- onboarding sample-deck step already inserts this way (OnboardingSteps.tsx). This
-- migration adds a trigger backstop so the cap holds regardless of insert path.
--
-- DESIGN.
--   * Statement-level AFTER INSERT trigger with a transition table → fires ONCE per
--     INSERT statement (not per row), so the app's chunked array inserts pay one check
--     per chunk, not one per card.
--   * GATED to genuine end-user inserts: `auth.role() = 'authenticated'`. service_role /
--     postgres / migration paths are EXEMPT. This matters for official-deck import:
--     import_official_deck writes the official_deck_manifest row AFTER the cards
--     (mig 082/095), so a limit check firing mid-import would momentarily see the
--     system user's official cards as non-official. The CLI runs that import as
--     service_role (PostgREST) or postgres (direct pg) → the role gate skips it. But
--     the RPC ALSO admits an authenticated ADMIN caller, whose role IS 'authenticated';
--     for that path the manifest-ordering hazard is covered instead by the per-owner
--     skip below (is_official), since the imported cards belong to the system user.
--   * BOUNDED probe (_owned_card_over_cap): existence of a (limit+1)-th qualifying card
--     via `OFFSET limit LIMIT 1` — O(limit), independent of library size. The UNLIMITED
--     sentinel (card_limit >= 1e9, mig 124) short-circuits to false so huge libraries
--     are never scanned on insert.
--   * Same per-user advisory-lock key (42) as check_card_limit → the trigger and the
--     reserve path serialize together; two concurrent inserts can't both slip past.
--   * Admin owners are never capped (mirrors check_card_limit / the session-limit bypass).
--
-- Counting semantics mirror _owned_card_count (mig 118) EXACTLY — owned OR active
-- 'subscribe' shares, official-certified decks excluded (card_limit_settings toggle) —
-- so the guard and the meter always agree, and the two official-deck rules hold:
--   (1) official decks never count; (2) a subscribed official deck used as-is nets 0,
--   while an owned copy/modification (new non-manifest deck) counts.
--
-- Idempotent/additive: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================================

-- ── Bounded over-cap probe: true iff p_owner now holds MORE than their cap of ──
-- non-official owned+subscribed cards. VOLATILE so it always sees the rows the firing
-- statement just inserted. UNLIMITED (>= 1e9) short-circuits without scanning.
CREATE OR REPLACE FUNCTION public._owned_card_over_cap(p_owner uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_over  boolean;
BEGIN
  IF p_owner IS NULL THEN RETURN false; END IF;
  -- COALESCE to the mig-116 default: if the singleton config row were ever missing,
  -- _owned_card_limit returns NULL — default to the cap (fail CLOSED), not to no-cap.
  v_limit := COALESCE(public._owned_card_limit(p_owner), 1000);
  -- Unlimited plans (sentinel >= 1e9, mig 124): never over — and DO NOT scan the library.
  IF v_limit >= 1000000000 THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE (
        d.user_id = p_owner
        OR EXISTS (
          SELECT 1 FROM deck_shares ds
          WHERE ds.deck_id = d.id
            AND ds.recipient_id = p_owner
            AND ds.share_mode = 'subscribe'
            AND ds.status = 'active'
        )
      )
      AND (
        (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
        OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
      )
    OFFSET v_limit          -- skip `limit` qualifying rows; a further row ⇒ over the cap
    LIMIT 1
  ) INTO v_over;

  RETURN v_over;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_over_cap(uuid) FROM PUBLIC, anon, authenticated;

-- ── Trigger fn: block an authenticated insert that pushes a deck owner over the cap ──
CREATE OR REPLACE FUNCTION public.enforce_card_ownership_limit()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Enforce ONLY for genuine end-user (JWT 'authenticated') inserts. service_role /
  -- postgres / migration paths (incl. official-deck import, which writes its manifest
  -- row AFTER the cards) are trusted and EXEMPT.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NULL;
  END IF;

  -- One check per distinct DECK OWNER among the freshly-inserted rows (matches
  -- _owned_card_count, which keys on decks.user_id — not cards.user_id). ORDER BY the
  -- owner so a multi-owner INSERT..SELECT always takes the per-owner advisory locks in
  -- a consistent order — no cross-owner deadlock between two concurrent such statements.
  FOR v_owner IN
    SELECT DISTINCT d.user_id
    FROM new_cards nc
    JOIN decks d ON d.id = nc.deck_id
    WHERE d.user_id IS NOT NULL
    ORDER BY d.user_id
  LOOP
    -- Never capped: admins (mirrors check_card_limit's admin-only bypass) and the ONE
    -- system/official user that owns official decks. We skip the system user by its fixed
    -- id — NOT by the grantable `is_official` flag — because import_official_deck writes
    -- the manifest row AFTER the cards (mig 095), so an authenticated-admin import would
    -- otherwise be false-blocked mid-import. Using is_official here would over-broaden the
    -- skip to every badge-granted publisher and open a direct-REST cap hole for them
    -- (check_card_limit only bypasses role='admin'), so we gate on the system-user id.
    IF v_owner = '00000000-0000-0000-0000-000000000001'::uuid
       OR EXISTS (SELECT 1 FROM profiles WHERE id = v_owner AND role = 'admin') THEN
      CONTINUE;
    END IF;
    -- Serialize per owner on the SAME key as check_card_limit so the trigger and the
    -- reserve path can't race two inserts both past the cap. Released at txn end.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text, 42));
    IF public._owned_card_over_cap(v_owner) THEN
      RAISE EXCEPTION 'card_limit_reached'
        USING errcode = 'PT402',
              hint    = 'CARD_LIMIT_REACHED',
              detail  = 'insert would exceed the owned-card limit';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_card_ownership_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_card_limit ON public.cards;
CREATE TRIGGER trg_enforce_card_limit
  AFTER INSERT ON public.cards
  REFERENCING NEW TABLE AS new_cards
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.enforce_card_ownership_limit();
