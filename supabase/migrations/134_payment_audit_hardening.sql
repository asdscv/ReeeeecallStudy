-- ============================================================================
-- 134: Payment audit HARDENING (round 2) — money = micro-WON / whole-WON.
--
-- Fixes 4 findings from the 2026-07-20 full web+mobile payment audit. All are
-- additive + idempotent (CREATE OR REPLACE only) and preserve the gated-off,
-- fail-closed posture: every write RPC stays SECURITY DEFINER, service_role/admin
-- guarded, REVOKEd from PUBLIC/anon/authenticated, GRANTed only to service_role
-- (plus is_admin() in the body). No client GRANTs added.
--
--   1) PLAN-CHANGE DESYNC (HIGH, web LemonSqueezy): a subscription upgrade/downgrade
--      in the LS customer portal fires subscription_updated → the webhook routed it
--      through sync_subscription, which updates ONLY status/period/cancel — never
--      product_id/tier/card_limit. So a user who downgrades unlimited→5k keeps the
--      unlimited card cap while paying the cheaper plan (and vice-versa on upgrade).
--      NEW sync_subscription_plan() applies the new catalog product (product_id +
--      tier + card_limit) atomically, with the same terminal-state guard as
--      sync_subscription. The LS webhook now routes subscription_updated here when it
--      can map the payload variant → product; otherwise it falls back to the
--      status-only sync_subscription (unchanged behaviour when the map is unset).
--
--   2) REFUNDED-SUB RESURRECTION on the RevenueCat path (MEDIUM): sync_subscription_by_user
--      → _upsert_subscription UNCONDITIONALLY sets status, so an out-of-order RENEWAL
--      after a REFUND/CHARGEBACK (same original_transaction_id) could flip a 'refunded'
--      row back to 'active' and re-grant the raised card cap with no payment. mig 126
--      added a terminal guard to sync_subscription (the LS/Toss lifecycle path) but NOT
--      to sync_subscription_by_user (the RevenueCat grant/renew path). Add it here.
--
--   3) NULL-PERIOD PERPETUAL SUB via the 3-arg confirm_payment (LOW/latent): the mig-120
--      confirm_payment(merchant_uid,provider,payment_id) subscription branch calls
--      grant_subscription(...,NULL) → an 'active', NULL-period, sub-id-less row that
--      _owned_card_limit treats as a perpetual admin-comp grant and that
--      revoke/sync_subscription (keyed on provider_subscription_id) can NEVER revoke.
--      Route that branch through activate_subscription_from_intent(..., merchant_uid,
--      NULL) instead, so the row records provider_subscription_id = merchant_uid and
--      stays revocable. (Not on any current happy path — LS/Toss subs grant via the
--      5-arg overload / activate_… directly — but a latent footgun, closed defensively.)
--
--   4) IAP CREDIT-PACK REFUND not clawed back (MEDIUM, mobile RevenueCat): a consumable
--      credit-pack bought via IAP is granted with add_ai_credits (ledger ref = the store
--      transaction id), but RevenueCat REFUND/CHARGEBACK routed to revoke_subscription
--      (keyed on original_transaction_id) → no sub row → no-op, credits never reversed.
--      clawback_credits (mig 127) can't help — it keys on a payment_intents merchant_uid,
--      which the IAP grant path never creates. NEW clawback_ai_credits_by_ref() reverses
--      a prior add_ai_credits grant identified by its LEDGER ref (idempotent), so the RC
--      webhook can claw back an IAP credit-pack refund by the same transaction key it
--      granted on. (Mobile IAP is still dormant — SDK not installed, paywall gated off —
--      so this path has NO prod grants yet and MUST be sandbox-verified at IAP launch.)
-- ============================================================================

-- ── 1) sync_subscription_plan — plan-aware lifecycle update (LS portal plan change) ──
-- UPDATE-ONLY the row matched by (provider, provider_subscription_id), setting the NEW
-- catalog product's product_id + tier + card_limit alongside status/period/cancel.
-- Same terminal-state guard as sync_subscription (mig 126): never resurrect a refunded
-- / lapsed-expired sub to an entitled state from an out-of-order event. No matching row
-- → {ok:false, reason:'not_found'} (never creates — first grant flows through
-- activate_subscription_from_intent). service_role / admin only.
CREATE OR REPLACE FUNCTION public.sync_subscription_plan(
    p_provider                 text,
    p_provider_subscription_id text,
    p_product_id               text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_user       uuid;
  v_cur_status text;
  v_cur_period timestamptz;
  v_kind       text;
  v_tier       text;
  v_card_limit integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription plan' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_status NOT IN ('active','canceled','expired','grace','past_due','paused','refunded') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = 'invalid_parameter_value';
  END IF;

  -- New product must exist AND be a subscription (else this would set a NULL/credit cap).
  SELECT kind, tier, card_limit INTO v_kind, v_tier, v_card_limit
  FROM billing_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_kind <> 'subscription' THEN
    RAISE EXCEPTION 'Product % is not a subscription', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  -- Lock + read the matched row so we can enforce terminal-state transitions.
  SELECT id, user_id, status, current_period_end
    INTO v_id, v_user, v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Terminal-state guard (mirrors mig 126 sync_subscription): never resurrect a refunded
  -- (or already lapsed 'expired') sub back to ANY entitled state from an out-of-order event.
  IF p_status IN ('active','grace','canceled','past_due')
     AND (
       v_cur_status = 'refunded'
       OR (v_cur_status = 'expired'
           AND (v_cur_period IS NULL OR v_cur_period <= now()))
     )
  THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  UPDATE billing_subscriptions
     SET product_id           = p_product_id,
         tier                 = COALESCE(v_tier, tier, 'pro'),
         card_limit           = v_card_limit,
         status               = p_status,
         current_period_end   = COALESCE(p_period_end, current_period_end),
         cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
         updated_at           = now()
   WHERE id = v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', p_status,
    'product_id', p_product_id, 'card_limit', v_card_limit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription_plan(text, text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription_plan(text, text, text, text, timestamptz, boolean)
  TO service_role;

-- ── 2) sync_subscription_by_user — add the terminal-state guard (RevenueCat path) ─────
-- Reproduces the mig-121 body VERBATIM except it now LOCKs + reads the existing
-- (provider, provider_subscription_id) row first and REFUSES to resurrect a terminal
-- (refunded / lapsed-expired) row to an entitled state — closing the out-of-order
-- RENEWAL-after-REFUND resurrection. A fresh re-subscribe uses a NEW
-- provider_subscription_id → no existing row → not terminal → proceeds (INSERT). The
-- shared _upsert_subscription helper is left untouched (its other caller
-- activate_subscription_from_intent runs only AFTER a verified paid intent, so a global
-- guard there would wrongly block a legitimate paid re-subscribe).
CREATE OR REPLACE FUNCTION public.sync_subscription_by_user(
    p_user                     uuid,
    p_product_id               text,
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind       text;
  v_tier       text;
  v_card_limit integer;
  v_cur_status text;
  v_cur_period timestamptz;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription' USING errcode = '42501';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_status NOT IN ('active','canceled','expired','grace','past_due','paused','refunded') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT kind, tier, card_limit INTO v_kind, v_tier, v_card_limit
  FROM billing_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_kind <> 'subscription' THEN
    RAISE EXCEPTION 'Product % is not a subscription', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  -- TERMINAL-STATE GUARD (mig 134): if an existing row for this (provider, sub id) is
  -- terminal, refuse an entitled transition rather than resurrecting it. Lock it so a
  -- concurrent refund + renewal serialize.
  SELECT status, current_period_end INTO v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF FOUND
     AND p_status IN ('active','grace','canceled','past_due')
     AND (
       v_cur_status = 'refunded'
       OR (v_cur_status = 'expired'
           AND (v_cur_period IS NULL OR v_cur_period <= now()))
     )
  THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  RETURN public._upsert_subscription(
    p_user, p_product_id, v_tier, v_card_limit,
    p_provider, p_provider_subscription_id, p_status, p_period_end,
    p_cancel_at_period_end, NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription_by_user(
  uuid, text, text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription_by_user(
  uuid, text, text, text, text, timestamptz, boolean)
  TO service_role;

-- ── 3) confirm_payment (3-arg) — route the subscription branch through the lifecycle
--      activator so it records a revocable provider_subscription_id (= merchant_uid),
--      never a NULL-period perpetual grant. Reproduces the mig-120 body verbatim except
--      the ELSIF kind='subscription' branch. credit_pack branch is unchanged.
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_merchant_uid        text,
    p_provider            text,
    p_provider_payment_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_intent payment_intents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment' USING errcode = '42501';
  END IF;

  -- Lock the row so concurrent redeliveries serialize on it.
  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment intent: %', p_merchant_uid
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- IDEMPOTENT: a redelivery of an already-confirmed intent is a no-op.
  IF v_intent.status = 'paid' THEN
    RETURN json_build_object('ok', true, 'already', true,
                             'kind', v_intent.kind, 'user_id', v_intent.user_id);
  END IF;

  IF v_intent.kind = 'credit_pack' THEN
    UPDATE payment_intents
       SET status              = 'paid',
           provider            = p_provider,
           provider_payment_id = p_provider_payment_id,
           paid_at             = now()
     WHERE merchant_uid = p_merchant_uid;
    PERFORM public.add_ai_credits(
      v_intent.user_id, v_intent.amount_micro_won, 'purchase', v_intent.merchant_uid);
    RETURN json_build_object('ok', true, 'kind', v_intent.kind, 'user_id', v_intent.user_id);

  ELSIF v_intent.kind = 'subscription' THEN
    -- mig 134: was grant_subscription(...,NULL) → an unrevokable NULL-period perpetual
    -- grant. Route through the lifecycle activator so the row records
    -- provider_subscription_id = merchant_uid (revocable via revoke/sync_subscription).
    -- activate_subscription_from_intent re-locks the (already-locked) intent, marks it
    -- paid itself, reads tier+card_limit from the catalog, and UPSERTs the sub.
    RETURN public.activate_subscription_from_intent(
      v_intent.merchant_uid, p_provider, v_intent.merchant_uid, NULL);

  ELSE
    RAISE EXCEPTION 'Unsupported intent kind: %', v_intent.kind
      USING errcode = 'invalid_parameter_value';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_payment(text, text, text) TO service_role;

-- ── 4) clawback_ai_credits_by_ref — reverse an add_ai_credits grant by its LEDGER ref ─
-- For IAP consumable credit-pack REFUND/CHARGEBACK: the grant was written by
-- add_ai_credits with a ledger ref = the store transaction key (NOT a payment_intents
-- merchant_uid), so clawback_credits (mig 127) can't find it. This looks up the POSITIVE
-- grant row by ref, and writes a NEGATIVE offsetting ledger row (reason='refund',
-- ref='refund:'||p_ref) reversing EXACTLY the granted amount (read from the ledger, never
-- trusted from the caller) + decrements the wallet. Idempotent on ref='refund:'||p_ref.
-- Balance may dip negative (the >=0 CHECK was dropped in mig 114/115). service_role/admin.
--
-- CORRECTNESS (re-audit fixes):
--   * money = micro-WON = BIGINT: a ₩10,000 pack is 1e10 micro-WON (> int4 max ~2.1e9), so
--     v_grant_delta / v_bal MUST be bigint (matching ai_credit_ledger.delta / balance),
--     else the reversal overflows (22003) and the refund silently never applies.
--   * LOCK-BEFORE-CHECK: acquire the grant-row FOR UPDATE lock FIRST, then evaluate the
--     'refund:'||ref idempotency guard, so two concurrent REFUND redeliveries serialize and
--     the loser observes the committed refund row (no double-decrement). Mirrors mig 127.
--   * REFUND-BEFORE-GRANT: if the grant hasn't landed yet, write a delta-0 TOMBSTONE (when
--     the user is known) so a later grant redelivery can be refused — the RC webhook checks
--     for this tombstone before granting. Keeps the refund durable regardless of arrival order.
CREATE OR REPLACE FUNCTION public.clawback_ai_credits_by_ref(
    p_user_id uuid,
    p_ref     text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant_user  uuid;
  v_grant_delta bigint;    -- micro-WON (bigint) — an int4 var overflows a ₩5,000+ pack
  v_bal         bigint;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to claw back credits' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'no_ref');
  END IF;

  -- LOCK the original positive grant row FIRST (ref is UNIQUE across positive-delta rows —
  -- ai_credit_ledger_grant_ref, mig 109) so concurrent redeliveries serialize on it. Then
  -- (below) evaluate idempotency while effectively serialized, mirroring clawback_credits.
  SELECT user_id, delta INTO v_grant_user, v_grant_delta
  FROM ai_credit_ledger
  WHERE ref = p_ref AND delta > 0
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  -- IDEMPOTENT: a refund (or tombstone) for this ref already landed → no-op. Evaluated
  -- AFTER the lock so a concurrent refund that already committed is visible (READ COMMITTED).
  IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'refund:' || p_ref) THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;

  -- REFUND BEFORE GRANT: no positive grant row yet. Durably TOMBSTONE (delta 0) so a later
  -- grant redelivery is refused by the RC webhook's pre-grant tombstone check. Needs the
  -- user; without it we cannot tombstone (just report grant_not_found).
  IF v_grant_user IS NULL THEN
    IF p_user_id IS NULL THEN
      RETURN json_build_object('ok', false, 'reason', 'grant_not_found');
    END IF;
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (p_user_id, 0, 'refund', 'refund:' || p_ref,
              COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user_id), 0));
    RETURN json_build_object('ok', true, 'tombstoned', true, 'reason', 'grant_not_found');
  END IF;

  -- Defensive: the caller's user must own the grant (never claw a different user's).
  IF p_user_id IS NOT NULL AND p_user_id <> v_grant_user THEN
    RETURN json_build_object('ok', false, 'reason', 'user_mismatch');
  END IF;

  -- Reverse: decrement the wallet + write a NEGATIVE ledger row (same self-contained
  -- pattern as clawback_credits / admin_adjust_wallet).
  INSERT INTO ai_credit_balance (user_id, balance)
    VALUES (v_grant_user, -v_grant_delta)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_grant_user, -v_grant_delta, 'refund', 'refund:' || p_ref, v_bal);

  RETURN json_build_object(
    'ok', true, 'clawed', v_grant_delta, 'user_id', v_grant_user, 'balance', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clawback_ai_credits_by_ref(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clawback_ai_credits_by_ref(uuid, text) TO service_role;
