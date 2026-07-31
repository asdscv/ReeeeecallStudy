-- ============================================================================
-- 179 — get_plan_limits(): the two plan numbers a paywall has to state out loud
--
-- Migration 154 made the free AI quota a settings value, and migration 177 gave
-- an admin a UI to change it (along with the owned-card cap). Neither number had
-- a public read path, so every surface that shows them keeps a HAND COPY:
--
--   packages/mobile/src/i18n/locales/*/paywall.json  (8 locales)
--     features.aiGeneration.free = "10 cards/day"   ← copy of ai_pricing_settings
--     features.cardStorage.free  = "1,000 cards"    ← copy of card_limit_settings
--
-- Change the quota from the admin panel and the paywall states a number that is
-- no longer true — on the screen whose whole job is telling someone what they
-- are buying. This function is the read path those surfaces were missing.
--
-- Same posture as get_public_plans() (mig 125): display-only, non-sensitive,
-- deliberately readable by `anon` as well as `authenticated`, because the same
-- numbers belong on a logged-out landing page.
--
-- Deliberately NOT usable for enforcement. `_owned_card_limit(uuid)` stays the
-- only answer to "what may THIS user own" — it is per-user (admins get
-- 2,000,000,000; a lapsed subscriber keeps a plan cap until period end), and it
-- stays REVOKEd from clients. This returns the FREE-TIER numbers, which are the
-- same for everyone, which is exactly what a Free-vs-Pro table compares.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT only. No table is touched.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_plan_limits()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    -- The free-tier owned-card cap. Not COALESCEd to a literal on purpose: a
    -- fallback constant here would be one more hand copy of the number this
    -- function exists to stop copying, hidden where nobody would look for it.
    -- mig 116 seeds the id = 1 row, so NULL means the config row was deleted —
    -- the caller should say nothing rather than say something invented.
    'free_card_limit',       (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1),
    -- Delegated, not reimplemented: _ai_free_cards_per_day() (mig 154) is what
    -- get_ai_generation_quota() itself reads, so the paywall and the generator
    -- cannot disagree about what "free" means.
    'free_ai_cards_per_day', public._ai_free_cards_per_day()
  );
$$;

COMMENT ON FUNCTION public.get_plan_limits() IS
  'Display-only free-tier limits for pricing/paywall surfaces (card cap + daily AI quota). '
  'Public by design, like get_public_plans(). NOT an entitlement check — see _owned_card_limit().';

-- Default privileges GRANT EXECUTE to PUBLIC on creation, and CREATE OR REPLACE
-- does not re-alter them, so revoke first and grant the two roles explicitly.
REVOKE EXECUTE ON FUNCTION public.get_plan_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_plan_limits() TO anon, authenticated;

COMMIT;
