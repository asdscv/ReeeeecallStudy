-- ============================================================================
-- 176: Remove the dead per-user session override (mig 048/049).
--
-- WHAT IT WAS. mig 049 shipped two ways to give a user more concurrent sessions:
-- an admin bypass, and a per-user number stored as
-- `subscriptions.metadata->>'max_sessions_override'`, written by
-- `admin_set_session_override(user_id, n)`. The session limiter of the day read
-- that key.
--
-- WHY IT IS DEAD. mig 093 rewrote enforcement as ONE SESSION PER PLATFORM
-- (`register_session`), and that rewrite does not consult the key. Verified
-- against a fully-migrated database rather than by reading migrations:
--
--     SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.prosrc ILIKE '%max_sessions_override%';
--     -- → admin_set_session_override(uuid,integer)   ← and nothing else
--
-- So the only code that mentions the key is the function that writes it. No RPC,
-- no trigger, no client (web/mobile grep is clean) reads it back.
--
-- WHY REMOVE IT RATHER THAN LEAVE IT. It is not inert, it is MISLEADING. The
-- function still exists, still passes its `is_admin()` gate, still reports
-- `{"success": true, "max_sessions_override": n}` — and changes nothing about how
-- many devices the user can hold. It also writes to the LEGACY `subscriptions`
-- table (`status IN ('active','trialing')`), which is not where billing lives
-- anymore, so even a re-wire would have read the wrong table.
--
-- NOTE ON THE TABLE: `subscriptions` itself is NOT dead — handle_new_user_subscription(),
-- get_user_subscription() and admin_set_subscription() still use it. Only the one
-- JSONB key goes.
--
-- ⚠️ DATA: the second statement deletes the dead key from any row that still
-- carries it. Nothing reads it, so this cannot change behaviour — the reason to
-- do it is that a future per-tier device-count feature (the alternative the ops
-- doc records) would otherwise silently inherit overrides set months earlier by a
-- function nobody remembers. Every removed value is printed to the apply log
-- first, so the numbers are recoverable from that output if anyone wants them.
--
-- Idempotent: IF EXISTS + a WHERE that matches nothing on a second run.
-- ============================================================================

BEGIN;

-- ── 1) the writer ───────────────────────────────────────────────────────────
-- Default privileges left EXECUTE to PUBLIC on this one (proacl was NULL — mig 098
-- fixed its search_path but never its grants); the in-body is_admin() check is what
-- kept it closed. REVOKE first so the grant cannot outlive a partial failure.
DO $$
BEGIN
  IF to_regprocedure('public.admin_set_session_override(uuid, integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_set_session_override(uuid, integer) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_set_session_override(uuid, integer);

-- ── 2) the values it wrote ──────────────────────────────────────────────────
DO $$
DECLARE
  r     record;
  n_hit integer := 0;
BEGIN
  FOR r IN
    SELECT user_id, metadata->>'max_sessions_override' AS override
      FROM public.subscriptions
     WHERE metadata ? 'max_sessions_override'
  LOOP
    n_hit := n_hit + 1;
    RAISE NOTICE 'mig176: dropping dead max_sessions_override=% for user %', r.override, r.user_id;
  END LOOP;

  IF n_hit = 0 THEN
    RAISE NOTICE 'mig176: no rows carried max_sessions_override — nothing to strip';
  ELSE
    UPDATE public.subscriptions
       SET metadata = metadata - 'max_sessions_override'
     WHERE metadata ? 'max_sessions_override';
    RAISE NOTICE 'mig176: stripped the dead key from % row(s)', n_hit;
  END IF;
END;
$$;

COMMIT;

-- PostgREST must forget the dropped RPC.
NOTIFY pgrst, 'reload schema';
