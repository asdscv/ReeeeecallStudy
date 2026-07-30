-- ============================================================================
-- credit_clawback_reversal_test.sql — undoing a credit clawback (mig 173).
--
-- WHY THIS EXISTS. The App Store can reverse a refund it already granted, and it
-- says so with a REFUND_REVERSED webhook. Every refund shape mig 134 writes was
-- one-way:
--   * a real clawback (delta < 0) took the credits back, and
--   * a delta-0 TOMBSTONE (refund arrived before its grant) made the ref
--     permanently unmintable via mig 158's guard.
-- So after a reversal the customer had paid and held nothing, with no code path
-- able to restore it. mig 173 adds reverse_credit_clawback() and teaches
-- credit_grant_is_refunded() that a reversed refund no longer blocks the grant.
--
-- The invariant these assertions pin, per grant ref:
--     grant + clawback + reversal = grant
-- The reversal is ALWAYS -1 × the clawback row's delta — read from the ledger,
-- never from the caller — so a tombstone reverses to 0.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role() read from request.jwt settings.
-- ============================================================================
\set ON_ERROR_STOP on
-- psql does NOT substitute :vars inside dollar-quoted blocks, and every assertion
-- here lives in one, so the ids are written out. Keep them in sync by search.
--   usr   ca000000-0000-0000-0000-0000000000a1
--   other ca000000-0000-0000-0000-0000000000a2
--   tomb  ca000000-0000-0000-0000-0000000000a3

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES ('ca000000-0000-0000-0000-0000000000a1'::uuid),('ca000000-0000-0000-0000-0000000000a2'::uuid),('ca000000-0000-0000-0000-0000000000a3'::uuid) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES ('ca000000-0000-0000-0000-0000000000a1'::uuid,'user'),('ca000000-0000-0000-0000-0000000000a2'::uuid,'user'),('ca000000-0000-0000-0000-0000000000a3'::uuid,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claim.role','service_role',false);

-- ═══ 1) grant → clawback → reversal restores EXACTLY the clawback ═══════════
-- Built with the real RPCs the webhook calls, not hand-written rows, so the chain
-- under test is the one production runs.
DO $$
DECLARE
  v_granted bigint;
  v_res     json;
BEGIN
  PERFORM public.add_ai_credits('ca000000-0000-0000-0000-0000000000a1'::uuid, 990000, 'purchase', 'rc:TXN1');
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid) = 990000,
    'the grant credited the wallet';

  PERFORM public.clawback_ai_credits_by_ref('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:TXN1');
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid) = 0,
    'the clawback emptied the wallet';
  ASSERT public.credit_grant_is_refunded('rc:TXN1') = true,
    'while the refund stands, the grant ref is blocked';

  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:TXN1');
  ASSERT (v_res->>'ok')::boolean = true, 'the reversal reports ok';
  ASSERT (v_res->>'restored')::bigint = 990000,
    format('the reversal restores exactly the clawed amount, got %s', v_res->>'restored');
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid) = 990000,
    'the wallet is back to the granted amount';

  -- grant + clawback + reversal = grant, stated directly on the ledger.
  SELECT SUM(delta) INTO v_granted FROM ai_credit_ledger
   WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid AND ref IN ('rc:TXN1','refund:rc:TXN1','reversal:rc:TXN1');
  ASSERT v_granted = 990000,
    format('the three rows net to the original grant, got %s', v_granted);

  -- The reversal is recorded as a positive purchase row, not a mutation of history.
  ASSERT (SELECT delta FROM ai_credit_ledger WHERE ref = 'reversal:rc:TXN1') = 990000,
    'the reversal row carries the positive amount';
END $$;

-- ═══ 2) the guard reopens only after the reversal ═══════════════════════════
DO $$
BEGIN
  ASSERT public.credit_grant_is_refunded('rc:TXN1') = false,
    'a REVERSED refund no longer blocks the grant';
  -- Not a blanket opening: an unrelated tombstone still blocks.
  ASSERT public.credit_grant_is_refunded('rc:TXN-none') = false,
    'an untouched ref was never blocked';
END $$;

-- ═══ 3) idempotency — a redelivered REFUND_REVERSED must not double-credit ══
DO $$
DECLARE v_res json;
BEGIN
  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:TXN1');
  ASSERT (v_res->>'already')::boolean = true, 'the second reversal is a no-op';
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid) = 990000,
    'the redelivery did not credit again';
  ASSERT (SELECT COUNT(*) FROM ai_credit_ledger WHERE ref = 'reversal:rc:TXN1') = 1,
    'exactly one reversal row exists';
END $$;

-- ═══ 4) refusals — nothing to reverse, no ref, wrong owner ═════════════════
DO $$
DECLARE v_res json;
BEGIN
  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:NEVER-REFUNDED');
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'reason' = 'no_clawback',
    'reversing a refund that never happened is a reported no-op, not a credit';
  -- PINS THE KNOWN LIMITATION (see the migration header): a reversal that arrives
  -- before its refund writes NOTHING, so the later refund still claws back. The
  -- alternative — a 'reversal:' marker that makes the clawback skip — cannot
  -- distinguish a second refund from the reversed one, and would mean keeping money
  -- we owe back. If this ever changes, this assertion must change with it.
  ASSERT (SELECT COUNT(*) FROM ai_credit_ledger
           WHERE ref IN ('reversal:rc:NEVER-REFUNDED','refund:rc:NEVER-REFUNDED')) = 0,
    'an out-of-order reversal leaves no marker behind';

  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, '');
  ASSERT v_res->>'reason' = 'no_ref', 'an empty ref is refused';

  -- Credits must never be restored onto a different account than the one they
  -- were taken from.
  PERFORM public.add_ai_credits('ca000000-0000-0000-0000-0000000000a2'::uuid, 500000, 'purchase', 'rc:TXN2');
  PERFORM public.clawback_ai_credits_by_ref('ca000000-0000-0000-0000-0000000000a2'::uuid, 'rc:TXN2');
  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:TXN2');
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'reason' = 'user_mismatch',
    'a reversal for another user''s clawback is refused';
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid) = 990000,
    'the refused reversal moved no money';
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a2'::uuid) = 0,
    'and did not restore the real owner either';
END $$;

-- ═══ 5) reversing a TOMBSTONE restores nothing but unblocks the grant ══════
-- The refund-before-grant case (mig 134): the tombstone took no money, so its
-- reversal must not invent any — it only has to let the delayed grant land.
DO $$
DECLARE v_res json;
BEGIN
  PERFORM public.clawback_ai_credits_by_ref('ca000000-0000-0000-0000-0000000000a3'::uuid, 'rc:TXN3');   -- no grant yet
  ASSERT (SELECT delta FROM ai_credit_ledger WHERE ref = 'refund:rc:TXN3') = 0,
    'the refund-before-grant case wrote a delta-0 tombstone';
  ASSERT public.credit_grant_is_refunded('rc:TXN3') = true,
    'the tombstone blocks the late grant';

  v_res := public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a3'::uuid, 'rc:TXN3');
  ASSERT (v_res->>'restored')::bigint = 0,
    'reversing a tombstone restores nothing (nothing was taken)';
  ASSERT (v_res->>'tombstone_lifted')::boolean = true, 'the lift is reported';
  ASSERT COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a3'::uuid), 0) = 0,
    'no credits were invented';
  ASSERT public.credit_grant_is_refunded('rc:TXN3') = false,
    'the late grant is no longer refused';

  -- And the grant, once it arrives, credits normally.
  PERFORM public.add_ai_credits('ca000000-0000-0000-0000-0000000000a3'::uuid, 990000, 'purchase', 'rc:TXN3');
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'ca000000-0000-0000-0000-0000000000a3'::uuid) = 990000,
    'the delayed grant finally lands';
END $$;

-- ═══ 6) authorization ══════════════════════════════════════════════════════
-- Restoring credits is minting money: service_role and admins only.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.reverse_credit_clawback('ca000000-0000-0000-0000-0000000000a1'::uuid, 'rc:TXN1');
    ASSERT false, 'authenticated must not execute reverse_credit_clawback';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ═══ 7) the wallet tables stay RPC-only ════════════════════════════════════
-- Same regression guard as credit_refund_guard_test.sql: the reversal must not have
-- been the excuse to hand an edge function direct table access.
--
-- The two roles are closed by DIFFERENT mechanisms, and both matter:
--   * service_role has no DML grant at all — it BYPASSES RLS, so a grant would be
--     a real open door (this is exactly what answered 42501 in mig 158);
--   * anon/authenticated keep Supabase's blanket schema grants, so the thing that
--     actually closes them is RLS enabled with ZERO policies. Asserting on their
--     grants would pin a property that was never true.
DO $$
BEGIN
  ASSERT has_table_privilege('service_role','public.ai_credit_ledger','SELECT') = false,
    'ai_credit_ledger must stay RPC-only for service_role';
  ASSERT has_table_privilege('service_role','public.ai_credit_balance','SELECT') = false,
    'ai_credit_balance must stay RPC-only for service_role';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_credit_ledger'::regclass),
    'ai_credit_ledger must keep RLS enabled';
  ASSERT (SELECT COUNT(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'ai_credit_ledger') = 0,
    'ai_credit_ledger must have NO policies — that is what closes anon/authenticated';
END $$;

ROLLBACK;
