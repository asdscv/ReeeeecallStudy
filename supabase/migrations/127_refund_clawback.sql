-- ============================================================================
-- 127: Credit-pack REFUND clawback + stale-intent expiry (money = micro-WON).
--
-- Closes the last TODO in the payment draft: a one-time credit-pack refund fired
-- by Lemon Squeezy (order_refunded, no subscription id) now REVERSES the credit
-- grant instead of just logging + acking. Adds a cron-callable sweeper that
-- expires payment_intents that were opened but never paid.
--
-- ALL money is micro-WON (1 unit = 1e-6 KRW; ₩1 = 1e6). A credit_pack intent
-- snapshots the granted amount into payment_intents.amount_micro_won (mig 120),
-- and confirm_payment → add_ai_credits (mig 114) credits exactly that on pay.
-- The clawback reverses THAT snapshot.
--
-- Both RPCs keep the fail-closed, gated-off posture: SECURITY DEFINER,
-- service_role/admin-guarded, REVOKE from PUBLIC/anon/authenticated, GRANT only
-- to service_role (the webhook calls them via the service-role client; is_admin()
-- stays in the guard as belt-and-suspenders). Additive + idempotent.
-- ============================================================================

-- ── 0) Allow status='refunded' on payment_intents ──────────────────────────────
-- The mig-120 inline CHECK only allowed pending/paid/failed/expired/canceled, so
-- clawback_credits setting status='refunded' would raise 23514. Widen it (drop the
-- auto-named column CHECK + re-add). Idempotent: DROP IF EXISTS then ADD.
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_status_check
  CHECK (status IN ('pending','paid','failed','expired','canceled','refunded'));

-- ── 1) clawback_credits(merchant_uid) — reverse a paid credit-pack grant ────────
-- service_role / admin only. Looks up the intent, requires kind='credit_pack' AND
-- status='paid'. IDEMPOTENT on ref='refund:'||merchant_uid: a re-delivery after the
-- first clawback returns {ok:true, already:true} (the intent is then 'refunded', so
-- the status gate would otherwise reject it — the idempotency branch runs FIRST).
--
-- Reversal is written DIRECTLY (like admin_adjust_wallet's negative branch, mig 122)
-- — NOT via add_ai_credits, which rejects delta<=0: a NEGATIVE ledger delta =
-- -(amount_micro_won) with reason='refund', ref='refund:'||merchant_uid, and the
-- balance is decremented by the same amount. The balance>=0 CHECK was dropped
-- (mig 114/115), so the wallet may dip negative. The intent flips to 'refunded'.
--
-- Concurrency: the intent row is locked FOR UPDATE, so concurrent LS redeliveries
-- serialize — the second call observes status='refunded' + the refund ledger row
-- and returns already:true. (The ai_credit_ledger idempotency unique index only
-- covers POSITIVE deltas, so this negative refund relies on the row lock + the
-- explicit EXISTS check for its at-most-once guarantee.)
CREATE OR REPLACE FUNCTION public.clawback_credits(p_merchant_uid text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_intent payment_intents%ROWTYPE;
  v_bal    bigint;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to claw back credits' USING errcode = '42501';
  END IF;

  -- Lock the intent so concurrent redeliveries serialize on it.
  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Only one-time credit packs are clawed here; subscription refunds go through
  -- revoke_subscription (mig 121).
  IF v_intent.kind <> 'credit_pack' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_credit_pack');
  END IF;

  -- IDEMPOTENT: a refund ledger row for this merchant_uid already landed → no-op.
  -- Runs BEFORE the status gate because the first clawback flips status→'refunded'.
  IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'refund:' || p_merchant_uid) THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;

  -- Never claw back an intent that never actually granted (pending/failed/expired/…).
  IF v_intent.status <> 'paid' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_paid', 'status', v_intent.status);
  END IF;

  -- Defensive: a paid credit_pack must carry the snapshotted amount (mig 120
  -- billing_products_kind_shape guarantees it); refuse rather than write NULL.
  IF v_intent.amount_micro_won IS NULL OR v_intent.amount_micro_won <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_amount');
  END IF;

  -- Reverse the grant: decrement the wallet + write a NEGATIVE ledger row. Balance
  -- may go negative (CHECK dropped). Same self-contained pattern as admin_adjust_wallet.
  INSERT INTO ai_credit_balance (user_id, balance)
    VALUES (v_intent.user_id, -v_intent.amount_micro_won)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_intent.user_id, -v_intent.amount_micro_won, 'refund',
            'refund:' || p_merchant_uid, v_bal);

  UPDATE payment_intents SET status = 'refunded' WHERE merchant_uid = p_merchant_uid;

  RETURN json_build_object(
    'ok', true, 'clawed_micro', v_intent.amount_micro_won,
    'user_id', v_intent.user_id, 'balance_micro', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clawback_credits(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clawback_credits(text) TO service_role;

-- ── 2) expire_stale_payment_intents(interval) — sweep never-paid intents ────────
-- service_role / admin only. Flips 'pending' intents older than p_older_than to
-- 'expired' and returns how many were touched. Purely hygiene: an expired intent
-- can no longer be confirmed-paid meaningfully (the checkout window is long gone),
-- and this keeps the pending list from growing unboundedly with abandoned checkouts.
--
-- CRON: schedule this to run periodically, e.g. hourly. Two options:
--   * pg_cron (if/when installed — currently it is NOT):
--       SELECT cron.schedule('expire-stale-payment-intents', '0 * * * *',
--         $$ SELECT public.expire_stale_payment_intents('24 hours'); $$);
--     (pg_cron jobs run as the scheduling superuser, which bypasses the GRANT.)
--   * a scheduled Edge Function / external cron hitting an endpoint that calls this
--     via the service-role client.
CREATE OR REPLACE FUNCTION public.expire_stale_payment_intents(
    p_older_than interval DEFAULT '24 hours')
  RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to expire payment intents' USING errcode = '42501';
  END IF;

  UPDATE payment_intents
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < now() - p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_payment_intents(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_stale_payment_intents(interval) TO service_role;
