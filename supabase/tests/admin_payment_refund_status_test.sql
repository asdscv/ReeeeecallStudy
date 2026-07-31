-- ============================================================================
-- admin_payment_refund_status_test.sql — the admin payment list must tell the
-- truth about a refunded credit pack (mig 175).
--
-- WHY THIS EXISTS. mig 156/159 asserted `'paid'::text AS status` for every
-- credit-pack row, so a refunded pack read "Paid" forever. That is not only a
-- wrong pill: AdminBillingPage shows the Refund button when
-- `status === 'paid' && kind === 'credit_pack'`, so the list was inviting an
-- admin to refund money we had already returned.
--
-- What these assertions pin, per grant ref:
--     grant → 'paid'   → clawback → 'refunded'   → reversal → 'paid'
-- and, critically, that the list's verdict is the SAME verdict the money path
-- uses (`credit_grant_is_refunded`) rather than a second, drifting copy of the
-- `refund:` / `reversal:` namespace rule.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role()/is_admin() read from the
-- request.jwt settings.
-- ============================================================================
\set ON_ERROR_STOP on
-- psql does NOT substitute :vars inside dollar-quoted blocks, and every assertion
-- lives in one, so the ids are written out. Keep them in sync by search.
--   adm   e1000000-0000-0000-0000-0000000000a1  (admin — calls the list)
--   buyer e1000000-0000-0000-0000-0000000000a2  (holds the grants)
\set adm '''e1000000-0000-0000-0000-0000000000a1'''
\set buyer '''e1000000-0000-0000-0000-0000000000a2'''

BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:adm),(:buyer) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:adm,'admin'),(:buyer,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- A WEB payment row, so the regression covers the other arm of the UNION: its
-- status is read from the table and must keep coming through untouched. 'refunded'
-- is the interesting value — if the fix ever gets applied to the wrong arm, this
-- row would start reporting 'paid'.
INSERT INTO payment_intents
  (merchant_uid, user_id, product_id, kind, amount_krw, amount_micro_won,
   status, provider, provider_payment_id, platform, paid_at, created_at)
VALUES
  ('pi_paystat_web_paid', :buyer, 'credits_10000', 'credit_pack', 0, 990000,
   'paid', 'lemonsqueezy', 'ls_1', 'web', now(), now()),
  ('pi_paystat_web_refunded', :buyer, 'credits_10000', 'credit_pack', 0, 990000,
   'refunded', 'lemonsqueezy', 'ls_2', 'web', now(), now());

SET session_replication_role = DEFAULT;

-- ── helper: the status this ref reports in the admin list ────────────────────
-- Defined for the test only (dropped by the ROLLBACK). Reads the real RPC output
-- the admin UI consumes, so an assertion cannot pass against a shape the UI does
-- not receive.
CREATE OR REPLACE FUNCTION pg_temp.listed_status(p_ref text)
  RETURNS text LANGUAGE sql AS $$
  SELECT e->>'status'
    FROM json_array_elements(public.admin_list_payments(500, 0, NULL)) e
   WHERE e->>'merchant_uid' = p_ref
$$;

-- ═══ 1) a live grant lists as paid ══════════════════════════════════════════
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  PERFORM public.add_ai_credits('e1000000-0000-0000-0000-0000000000a2'::uuid, 990000, 'purchase', 'rc:PAYSTAT1');
  ASSERT public.credit_grant_is_refunded('rc:PAYSTAT1') = false, 'a fresh grant is not refunded';
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  ASSERT pg_temp.listed_status('rc:PAYSTAT1') = 'paid',
    format('an un-refunded grant lists as paid, got %s', pg_temp.listed_status('rc:PAYSTAT1'));
END $$;

-- ═══ 2) THE BUG: after the clawback the row must say refunded ═══════════════
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  PERFORM public.clawback_ai_credits_by_ref('e1000000-0000-0000-0000-0000000000a2'::uuid, 'rc:PAYSTAT1');
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id = 'e1000000-0000-0000-0000-0000000000a2'::uuid) = 0,
    'the clawback actually took the credits back';
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  -- This is the assertion that fails against mig 159's hardcoded 'paid'.
  ASSERT pg_temp.listed_status('rc:PAYSTAT1') = 'refunded',
    format('a clawed-back grant must list as refunded, got %s', pg_temp.listed_status('rc:PAYSTAT1'));
  -- And the consequence that mattered: the UI hides its Refund button on any
  -- status other than 'paid', so this is what stops the double-refund prompt.
  ASSERT pg_temp.listed_status('rc:PAYSTAT1') <> 'paid',
    'a refunded pack must not offer the refund button again';
END $$;

-- ═══ 3) a REVERSED refund flips back to paid ═══════════════════════════════
-- The store can undo a refund (REFUND_REVERSED → mig 173). The customer is paid
-- up again, so the list must be refundable again too — a one-way 'refunded'
-- would strand the row.
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE v_res json;
BEGIN
  v_res := public.reverse_credit_clawback('e1000000-0000-0000-0000-0000000000a2'::uuid, 'rc:PAYSTAT1');
  ASSERT (v_res->>'restored')::bigint = 990000, 'the reversal restored the credits';
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  ASSERT pg_temp.listed_status('rc:PAYSTAT1') = 'paid',
    format('a reversed refund lists as paid again, got %s', pg_temp.listed_status('rc:PAYSTAT1'));
END $$;

-- ═══ 4) the list and the money path share ONE definition of "refunded" ══════
-- The point of routing through credit_grant_is_refunded() instead of
-- re-implementing the `refund:` / `reversal:` namespace rule. If someone inlines
-- a second copy and it drifts, this fails.
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  PERFORM public.add_ai_credits('e1000000-0000-0000-0000-0000000000a2'::uuid, 500000, 'purchase', 'rc:PAYSTAT2');
  PERFORM public.clawback_ai_credits_by_ref('e1000000-0000-0000-0000-0000000000a2'::uuid, 'rc:PAYSTAT2');
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e->>'merchant_uid' AS ref, e->>'status' AS status
      FROM json_array_elements(public.admin_list_payments(500, 0, NULL)) e
     WHERE e->>'kind' = 'credit_pack'
       AND (e->>'merchant_uid' LIKE 'rc:%' OR e->>'merchant_uid' LIKE 'rcev:%')
  LOOP
    ASSERT (r.status = 'refunded') = public.credit_grant_is_refunded(r.ref),
      format('list status %s disagrees with credit_grant_is_refunded for %s', r.status, r.ref);
  END LOOP;
END $$;

-- ═══ 5) the payment_intents arm still reports its own status ════════════════
DO $$
BEGIN
  ASSERT pg_temp.listed_status('pi_paystat_web_paid') = 'paid',
    'a paid web intent still lists as paid';
  ASSERT pg_temp.listed_status('pi_paystat_web_refunded') = 'refunded',
    'a refunded web intent still lists as refunded (read from the table, not asserted)';
END $$;

-- ═══ 6) nothing about the row's identity or money changed ══════════════════
-- The fix is a status derivation, not a rewrite: the amount must stay the GROSS
-- grant (what was charged), and the channel/refundability columns the UI colours
-- must survive.
DO $$
DECLARE e jsonb;
BEGIN
  SELECT x::jsonb INTO e FROM json_array_elements(public.admin_list_payments(500, 0, NULL)) x
   WHERE x->>'merchant_uid' = 'rc:PAYSTAT2';
  ASSERT (e->>'amount_micro')::bigint = 500000,
    'the listed amount is still the gross grant';
  ASSERT e->>'provider' = 'revenuecat', 'provider survives';
  ASSERT e->>'kind' = 'credit_pack', 'kind survives';
  ASSERT e ? 'can_refund_money', 'the channel refundability flag survives';
  ASSERT e ? 'environment', 'the sandbox/production marker survives';
END $$;

-- ═══ 7) authorization is unchanged — a plain user cannot read the list ══════
-- The fix calls a service_role-only function from inside a definer; that must not
-- have widened the door.
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-0000000000a2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_list_payments(10, 0, NULL);
    ASSERT false, 'a non-admin must not read the payment list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
