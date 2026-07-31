-- ============================================================================
-- 141: Close two card-limit RLS gaps found by the logic audit (L2 + L5).
--
-- L2 — deck_shares "Recipients update shares" (mig 009:73-74) is FOR UPDATE with NO
--   WITH CHECK, so a recipient can PATCH a revoked SUBSCRIBE share back to 'active'
--   via raw PostgREST, re-entering the cap count with no check (the only cap check
--   lives inside acquire_listing / accept_invite). Fix: a BEFORE UPDATE trigger that
--   enforces check_card_limit on any SUBSCRIBE share transitioning INTO 'active'.
--   Legit paths already pass (accept_invite pre-checks; acquire_listing INSERTs, not
--   UPDATEs). service_role / admins bypass. This closes reactivation via ANY path.
--
-- L5 — cards RLS "Users can CRUD own cards" (mig 001:154) is FOR ALL USING with no
--   WITH CHECK, so INSERT only requires user_id = auth.uid() — a user can key a card
--   to ANOTHER user's deck_id (counts toward the victim's cap). Fix: add a WITH CHECK
--   that also requires the target deck be owned by the caller. SECURITY DEFINER RPCs
--   (copy/import) run as the table owner and bypass RLS, so they are unaffected.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY/TRIGGER IF EXISTS.
-- ============================================================================

-- ── L2: enforce the cap on SUBSCRIBE share (re)activation ────────────────────
CREATE OR REPLACE FUNCTION public.enforce_share_reactivation_limit()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_add integer;
BEGIN
  -- Only a SUBSCRIBE share entering 'active' from a non-active state re-adds to the count.
  IF NEW.share_mode <> 'subscribe' OR NEW.status <> 'active' OR OLD.status = 'active' THEN
    RETURN NEW;
  END IF;
  -- Trusted server paths (Edge/sync) and admins are never capped.
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.recipient_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.recipient_id AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  -- Non-official cards this (re)activation would add toward the recipient's cap.
  SELECT count(*)::int INTO v_add
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE d.id = NEW.deck_id
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    );
  PERFORM public.check_card_limit(NEW.recipient_id, v_add);  -- raises PT402 if over the cap

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_share_reactivation_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_share_reactivation ON public.deck_shares;
CREATE TRIGGER trg_enforce_share_reactivation
  BEFORE UPDATE OF status ON public.deck_shares
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND NEW.share_mode = 'subscribe')
  EXECUTE FUNCTION public.enforce_share_reactivation_limit();

-- ── L5: cards INSERT/UPDATE must target a deck the caller OWNS ────────────────
DROP POLICY IF EXISTS "Users can CRUD own cards" ON public.cards;
CREATE POLICY "Users can CRUD own cards" ON public.cards
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM decks d WHERE d.id = deck_id AND d.user_id = auth.uid())
  );
