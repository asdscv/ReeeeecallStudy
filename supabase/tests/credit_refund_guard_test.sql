-- ============================================================================
-- credit_refund_guard_test.sql — the refund-before-grant guard (migs 134/158).
--
-- WHY THIS EXISTS. mig 134's guard was written as a DIRECT table read from the
-- RevenueCat webhook:
--     sb.from('ai_credit_ledger').select('id').eq('ref', 'refund:' + creditRef)
-- but ai_credit_ledger is RPC-only by design (mig 109: RLS on, no table grants).
-- service_role has no SELECT on it, so that query answered 42501 on every call —
-- and the webhook discarded the error, so the guard never fired once. A refund that
-- arrived before its grant tombstoned the ref and the grant landed anyway: credits
-- issued for a purchase the store had already refunded.
--
-- mig 158 replaces the read with credit_grant_is_refunded(). These assertions pin
-- BOTH halves of what went wrong:
--   * the predicate answers correctly for service_role (the caller that failed), and
--   * the table stays closed to direct reads — so the next person who reaches for
--     `.from('ai_credit_ledger')` in an edge function fails loudly here instead of
--     silently in production.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role() read from request.jwt settings.
-- ============================================================================
\set ON_ERROR_STOP on
\set usr '''c8000000-0000-0000-0000-0000000000a1'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES (:usr) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:usr,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

-- ═══ 1) the predicate itself ════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role','service_role',false);

DO $$
BEGIN
  -- nothing recorded yet → not refunded
  ASSERT public.credit_grant_is_refunded('rc:1000000999') = false,
    'an untouched grant ref is not refunded';
END $$;

-- A clawback (mig 134) writes its reversal under ref = 'refund:' || <grant ref>.
-- This is also the shape of the delta-0 tombstone written when the REFUND beats
-- the grant — one lookup has to answer both cases.
SET session_replication_role = replica;
INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, created_at)
VALUES (:usr, 0, 'refund', 'refund:rc:1000000999', 0, now());
SET session_replication_role = DEFAULT;

DO $$
BEGIN
  ASSERT public.credit_grant_is_refunded('rc:1000000999') = true,
    'a tombstoned grant ref reports refunded';
  -- The caller passes the GRANT ref; it must not double-prefix.
  ASSERT public.credit_grant_is_refunded('refund:rc:1000000999') = false,
    'the tombstone ref itself is not a grant ref (no double prefixing)';
  ASSERT public.credit_grant_is_refunded('rc:other') = false,
    'refs do not bleed across transactions';
END $$;

-- ═══ 2) authorization ═══════════════════════════════════════════════════════
-- A plain user must not be able to probe another account's ledger refs.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','c8000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.credit_grant_is_refunded('rc:1000000999');
    ASSERT false, 'authenticated must not execute credit_grant_is_refunded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ═══ 3) the table stays RPC-only ════════════════════════════════════════════
-- THE regression guard. If someone re-grants service_role direct SELECT here, the
-- door mig 109 deliberately closed is open again and a future edge function will
-- quietly read the table instead of going through a definer function.
DO $$
BEGIN
  ASSERT has_table_privilege('service_role','public.ai_credit_ledger','SELECT') = false,
    'ai_credit_ledger must stay RPC-only for service_role (use credit_grant_is_refunded)';
  ASSERT has_table_privilege('service_role','public.ai_credit_balance','SELECT') = false,
    'ai_credit_balance must stay RPC-only for service_role';
END $$;

ROLLBACK;
