-- ============================================================================
-- session_override_removed_test.sql — the dead per-user session override is gone,
-- and the live limiter is untouched (mig 176).
--
-- WHY THIS EXISTS. `admin_set_session_override()` (mig 049) wrote
-- `subscriptions.metadata->>'max_sessions_override'`, and mig 093's rewrite to
-- ONE SESSION PER PLATFORM stopped reading it. The function kept answering
-- `{"success": true, ...}` while changing nothing, so an admin could "raise a
-- user's device limit" and be quietly wrong.
--
-- Two halves are asserted, and the second is the one that matters: removing dead
-- code must not remove LIVE behaviour. If `register_session` had secretly
-- depended on the key, section 3 would fail.
--
-- Runs in a txn and ROLLBACKs → leaves no data.
-- ============================================================================
\set ON_ERROR_STOP on
--   usr   f1000000-0000-0000-0000-0000000000a1
\set usr '''f1000000-0000-0000-0000-0000000000a1'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES (:usr) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:usr,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

-- ═══ 1) the writer is gone, by every name it ever had ═══════════════════════
DO $$
BEGIN
  ASSERT to_regprocedure('public.admin_set_session_override(uuid, integer)') IS NULL,
    'admin_set_session_override must be dropped';
  -- Not just that overload: no signature of that name may survive.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_set_session_override'),
    'no overload of admin_set_session_override may remain';
END $$;

-- ═══ 2) nothing in the database mentions the key any more ═══════════════════
-- This is the assertion that would have caught the original problem: the key had
-- exactly one mention left, and it was its own writer.
DO $$
DECLARE v_refs text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_refs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ILIKE '%max_sessions_override%';
  ASSERT v_refs IS NULL,
    format('no function may reference max_sessions_override, found: %s', v_refs);

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.subscriptions WHERE metadata ? 'max_sessions_override'),
    'no subscription row may still carry the dead key';
END $$;

-- ═══ 3) the LIVE limiter still behaves — one session per platform ═══════════
-- mig 093's contract, re-proved after the removal. If the override key had been
-- load-bearing, this is where it would show.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.register_session('dev-web-1', 'Chrome', 'web');
  ASSERT (r->>'allowed')::boolean = true, 'the first web session is allowed';

  -- A second WEB device evicts the first (that is the limit, and it is not a
  -- counter that an override could have raised).
  r := public.register_session('dev-web-2', 'Firefox', 'web');
  ASSERT (r->>'allowed')::boolean = true, 'the newer web session is allowed';
  ASSERT (SELECT COUNT(*) FROM user_sessions
           WHERE user_id = 'f1000000-0000-0000-0000-0000000000a1'::uuid AND platform = 'web') = 1,
    'exactly one web session survives';
  ASSERT EXISTS (SELECT 1 FROM user_sessions
                  WHERE user_id = 'f1000000-0000-0000-0000-0000000000a1'::uuid AND device_id = 'dev-web-2'),
    'the survivor is the most recent device';

  -- The platforms are independent: an app session coexists with the web one.
  r := public.register_session('dev-app-1', 'iPhone', 'app');
  ASSERT (r->>'allowed')::boolean = true, 'an app session is allowed alongside web';
  ASSERT (SELECT COUNT(*) FROM user_sessions
           WHERE user_id = 'f1000000-0000-0000-0000-0000000000a1'::uuid) = 2,
    'one per platform, not one in total';
END $$;

ROLLBACK;
