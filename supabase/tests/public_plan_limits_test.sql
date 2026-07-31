-- ============================================================================
-- public_plan_limits_test.sql — get_plan_limits() is a PUBLIC read of the two
-- free-tier numbers a pricing surface quotes (mig 179).
--
-- WHY THIS EXISTS. The mobile paywall wrote both numbers into copy, in 8 locale
-- files: "1,000 cards" and "10 cards/day". mig 154 made the AI quota a setting
-- and mig 177 gave an admin a UI for both, so those literals go stale the first
-- time anyone touches that panel — on the screen that tells a person what they
-- are buying. This function is the read path they were missing.
--
-- What is pinned here:
--   1. it reports what is STORED, not a default it invented — the whole point;
--   2. `anon` can call it (a logged-out landing page shows the same numbers),
--      which is a deliberate exposure decision and must not regress silently;
--   3. it is NOT an entitlement check: the number it returns is the free-tier
--      one for everybody, and in particular it does NOT become 2,000,000,000
--      for an admin the way `_owned_card_limit()` does. That confusion is the
--      easy wrong implementation, so it is pinned rather than commented;
--   4. the underlying config tables stay unreadable directly — 179 opened one
--      function, not the tables;
--   5. it tracks the AI quota through the same helper the generator uses, so
--      the paywall and the generator cannot disagree about what "free" means.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block execution; role behaviour is simulated via request.jwt and
-- privileges are asserted with has_function_privilege().
-- ============================================================================
\set ON_ERROR_STOP on
--   adm   c9000000-0000-0000-0000-0000000000b1  (admin)
--   usr   c9000000-0000-0000-0000-0000000000b2  (plain user)
\set adm '''c9000000-0000-0000-0000-0000000000b1'''
\set usr '''c9000000-0000-0000-0000-0000000000b2'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES (:adm),(:usr) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:adm,'admin'),(:usr,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

-- ═══ 1) it reports what is STORED ═════════════════════════════════════════
-- Written directly rather than through the admin setters, so the READ is proved
-- independently of the write path. Values chosen so a hardcoded 1000/10 cannot
-- pass by coincidence.
UPDATE card_limit_settings SET max_owned_cards   = 4321 WHERE id = 1;
UPDATE ai_pricing_settings SET free_cards_per_day = 37  WHERE id = 1;

DO $$
DECLARE l json;
BEGIN
  l := public.get_plan_limits();
  ASSERT (l->>'free_card_limit')::int = 4321,
    format('the free card cap comes from card_limit_settings, got %s', l->>'free_card_limit');
  ASSERT (l->>'free_ai_cards_per_day')::int = 37,
    format('the free AI quota comes from ai_pricing_settings, got %s', l->>'free_ai_cards_per_day');
END $$;

-- ═══ 2) it agrees with the generator about what "free" means ══════════════
-- Delegation, not a second copy of the rule: if this ever diverges, the paywall
-- advertises one quota while get_ai_generation_quota() enforces another.
DO $$
DECLARE l json;
BEGIN
  l := public.get_plan_limits();
  ASSERT (l->>'free_ai_cards_per_day')::int = public._ai_free_cards_per_day(),
    'the quota must be the same helper get_ai_generation_quota() reads';
END $$;

-- ═══ 3) the number is the FREE-TIER one, for everyone ═════════════════════
-- `_owned_card_limit(uuid)` answers a different question — what may THIS user
-- own — and returns 2,000,000,000 for an admin. Reaching for it here would put
-- "Free: 2,000,000,000 cards" on the paywall for anyone with the admin role.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','c9000000-0000-0000-0000-0000000000b1',false);
DO $$
DECLARE l json;
BEGIN
  l := public.get_plan_limits();
  ASSERT (l->>'free_card_limit')::int = 4321,
    format('an admin caller still gets the FREE-tier cap, got %s', l->>'free_card_limit');
  ASSERT (l->>'free_card_limit')::bigint <> 2000000000,
    'this must never return the admin sentinel from _owned_card_limit()';
END $$;

SELECT set_config('request.jwt.claim.sub','c9000000-0000-0000-0000-0000000000b2',false);
DO $$
DECLARE l json;
BEGIN
  l := public.get_plan_limits();
  ASSERT (l->>'free_card_limit')::int = 4321, 'a plain user gets the same number';
  ASSERT (l->>'free_ai_cards_per_day')::int = 37, 'a plain user gets the same quota';
END $$;

-- ═══ 4) it is genuinely public ════════════════════════════════════════════
-- A logged-out landing page carries the same figures. REVOKE-then-GRANT is what
-- makes this true; CREATE OR REPLACE alone would have left the PUBLIC default in
-- place, which grants it more broadly than intended rather than less.
DO $$
BEGIN
  ASSERT has_function_privilege('anon', 'public.get_plan_limits()', 'EXECUTE'),
    'anon must be able to read display-only plan limits';
  ASSERT has_function_privilege('authenticated', 'public.get_plan_limits()', 'EXECUTE'),
    'authenticated must be able to read display-only plan limits';
END $$;

-- ═══ 5) 179 opened a FUNCTION, not the tables ═════════════════════════════
-- Asserted as EFFECTIVE READS, not as grants. Both tables carry a table-level
-- SELECT grant to anon/authenticated (mig 116/154 never revoked it); what makes
-- them unreadable is RLS-on-with-zero-policies, so `has_table_privilege` returns
-- true here and would make a grant-based assertion fail while nothing leaks.
-- Testing the behaviour is also the stronger test: it fails if EITHER the grant
-- widens or a future migration disables RLS.
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.card_limit_settings;
  ASSERT n = 0, format('anon must read no card_limit_settings rows, saw %s', n);
  SELECT count(*) INTO n FROM public.ai_pricing_settings;
  ASSERT n = 0, format('anon must read no ai_pricing_settings rows, saw %s', n);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.card_limit_settings;
  ASSERT n = 0, format('authenticated must read no card_limit_settings rows, saw %s', n);
  SELECT count(*) INTO n FROM public.ai_pricing_settings;
  ASSERT n = 0, format('authenticated must read no ai_pricing_settings rows, saw %s', n);
END $$;
RESET ROLE;

-- The protection above is RLS, so pin the two properties it rests on. Zero
-- policies is not an oversight to be "fixed" later by adding one — it is the
-- mechanism, and a permissive policy added here would open the admin knobs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relrowsecurity,
                  (SELECT count(*) FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS npol
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname IN ('card_limit_settings','ai_pricing_settings')
  LOOP
    ASSERT r.relrowsecurity, format('%s must keep RLS enabled', r.relname);
    ASSERT r.npol = 0, format('%s must keep zero policies, found %s', r.relname, r.npol);
  END LOOP;
END $$;

-- ═══ 6) it returns exactly the two fields the callers model ═══════════════
-- A field that appears here without a caller is a field nobody validates. In
-- particular the admin-only pricing knobs must not ride along.
DO $$
DECLARE l jsonb;
BEGIN
  l := public.get_plan_limits()::jsonb;
  ASSERT l ? 'free_card_limit' AND l ? 'free_ai_cards_per_day', 'both fields are present';
  ASSERT (SELECT count(*) FROM jsonb_object_keys(l)) = 2,
    format('exactly two display fields, got %s', (SELECT string_agg(k,',') FROM jsonb_object_keys(l) k));
  ASSERT NOT (l ? 'target_margin_bps') AND NOT (l ? 'won_per_credit'),
    'admin pricing knobs must not leak through a public function';
END $$;

-- ═══ 7) a missing config row says nothing rather than inventing a number ══
-- mig 116 seeds id = 1, so this is the "someone deleted the row" case. The
-- client treats NULL as "could not read" and renders number-free copy; a
-- COALESCE to a literal here would reintroduce the hand copy 179 removes.
DELETE FROM card_limit_settings WHERE id = 1;
DO $$
DECLARE l json;
BEGIN
  l := public.get_plan_limits();
  ASSERT l->>'free_card_limit' IS NULL,
    format('a missing config row yields NULL, not a default, got %s', l->>'free_card_limit');
END $$;

ROLLBACK;

\echo 'public_plan_limits_test: PASS'
