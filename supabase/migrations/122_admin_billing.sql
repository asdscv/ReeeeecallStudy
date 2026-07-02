-- ============================================================================
-- 122: ADMIN billing-management RPCs — view + manage ALL billing from the admin
-- dashboard. Sits on top of migs 119 (billing_products / billing_subscriptions /
-- grant_subscription / admin_grant_subscription), 120 (payment_intents /
-- confirm_payment) and 121 (subscription lifecycle: provider_subscription_id,
-- cancel_at_period_end, sync/revoke_subscription) plus the AI-credit wallet
-- (109/114: ai_credit_balance / ai_credit_ledger / add_ai_credits).
--
-- ALL money is micro-WON (1 unit = 1e-6 KRW; ₩1 = 1e6). billing_products.price_krw
-- is whole WON, so a subscription's monthly value in micro-WON = price_krw * 1e6.
--
-- Every RPC here:
--   * SECURITY DEFINER, SET search_path = public.
--   * is_admin()-GUARDED — `IF NOT public.is_admin() THEN RAISE ... errcode='42501'`.
--     This guard is the REAL gate; the GRANT to `authenticated` only lets an admin's
--     JWT reach the guard (a non-admin authenticated caller is rejected inside it).
--   * REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
--   * Read-only getters read auth.users for the account email (definer can).
--
-- admin_grant_subscription (mig 119) and admin_confirm_payment (mig 120) already
-- exist and are NOT recreated here — the UI calls those directly.
--
-- Additive/idempotent: CREATE OR REPLACE only.
-- ============================================================================

-- ── 0) Allow 'admin_adjustment' in the credit ledger reason CHECK (support
--     credit / claw-back writes). The prior domain (mig 115) forbade it → 23514. ──
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_reason_check;
ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_reason_check
  CHECK (reason IN ('purchase','spend','refund','admin_grant','spend_cards','spend_image','admin_adjustment'));

-- ── 1) admin_billing_overview() — top-line billing KPIs for the dashboard ─────
CREATE OR REPLACE FUNCTION public.admin_billing_overview()
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    'active_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'active'),
    'canceling',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE cancel_at_period_end = true),
    'past_due',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'past_due'),
    -- MRR: sum the catalog price (micro-WON) of every ACTIVE sub's product.
    'mrr_micro_won',
      COALESCE((
        SELECT SUM(p.price_krw::bigint * 1000000)
        FROM billing_subscriptions s
        JOIN billing_products p ON p.id = s.product_id
        WHERE s.status = 'active'
      ), 0),
    'wallet_total_micro',
      COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    -- Paid revenue in the last 30 days (micro-WON). Prefer the snapshotted
    -- amount_micro_won; fall back to amount_krw*1e6 (subscriptions carry no micro).
    'paid_revenue_30d_micro',
      COALESCE((
        SELECT SUM(COALESCE(amount_micro_won, amount_krw::bigint * 1000000))
        FROM payment_intents
        WHERE status = 'paid' AND paid_at > now() - interval '30 days'
      ), 0),
    'refunds_30d',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'refunded' AND updated_at > now() - interval '30 days')
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_billing_overview() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_billing_overview() TO authenticated;

-- ── 2) admin_list_subscriptions() — paginated subscription list w/ account email ─
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
    p_status text DEFAULT NULL,
    p_limit  int  DEFAULT 50,
    p_offset int  DEFAULT 0)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT s.id, s.user_id, u.email, s.tier, s.status, s.card_limit,
           s.provider, s.provider_subscription_id, s.current_period_end,
           s.cancel_at_period_end, s.created_at, s.updated_at
    FROM billing_subscriptions s
    LEFT JOIN auth.users u ON u.id = s.user_id
    WHERE p_status IS NULL OR s.status = p_status
    ORDER BY s.updated_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_subscriptions(text, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_subscriptions(text, int, int) TO authenticated;

-- ── 3) admin_list_payments() — paginated payment-intent list w/ account email ───
CREATE OR REPLACE FUNCTION public.admin_list_payments(
    p_limit  int DEFAULT 50,
    p_offset int DEFAULT 0)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
           pi.amount_krw, pi.status, pi.provider, pi.provider_payment_id,
           pi.paid_at, pi.created_at
    FROM payment_intents pi
    LEFT JOIN auth.users u ON u.id = pi.user_id
    ORDER BY pi.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_payments(int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_payments(int, int) TO authenticated;

-- ── 4) admin_get_user_billing() — one user's full billing picture ─────────────
CREATE OR REPLACE FUNCTION public.admin_get_user_billing(p_user uuid)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    -- active sub preferred, else the most recently touched row (or null).
    'subscription', (
      SELECT row_to_json(s) FROM (
        SELECT id, user_id, product_id, tier, status, card_limit, provider,
               provider_ref, provider_subscription_id, current_period_end,
               cancel_at_period_end, created_at, updated_at
        FROM billing_subscriptions
        WHERE user_id = p_user
        ORDER BY (status = 'active') DESC, updated_at DESC
        LIMIT 1
      ) s),
    'wallet_micro',
      COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user), 0),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(l)) FROM (
        SELECT delta, reason, balance_after, created_at
        FROM ai_credit_ledger
        WHERE user_id = p_user
        ORDER BY created_at DESC
        LIMIT 20
      ) l), '[]'::json),
    'payments', COALESCE((
      SELECT json_agg(row_to_json(pm)) FROM (
        SELECT merchant_uid, product_id, kind, amount_krw, status, paid_at, created_at
        FROM payment_intents
        WHERE user_id = p_user
        ORDER BY created_at DESC
        LIMIT 20
      ) pm), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_billing(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_user_billing(uuid) TO authenticated;

-- ── 5) admin_cancel_subscription() — app-side cancel/expire override ───────────
-- Matched by (provider, provider_subscription_id).
--   p_immediate = false (default) → status='canceled', cancel_at_period_end=true:
--     the user keeps access through current_period_end (mig-121 _owned_card_limit
--     grants the plan cap while status IN (active,canceled,grace,past_due) AND the
--     period has not passed).
--   p_immediate = true            → status='expired', cancel_at_period_end=false:
--     access is dropped NOW (expired no longer grants the plan cap).
-- NOTE (MoR / LemonSqueezy): the REAL money refund is issued in the LemonSqueezy
-- dashboard, which fires a webhook → revoke_subscription (mig 121, status='refunded').
-- This RPC is only the APP-SIDE entitlement override (support tooling); it does NOT
-- move money and does NOT call the provider.
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(
    p_provider                 text,
    p_provider_subscription_id text,
    p_immediate                boolean DEFAULT false)
  RETURNS json
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  IF COALESCE(p_immediate, false) THEN
    UPDATE billing_subscriptions
       SET status = 'expired', cancel_at_period_end = false, updated_at = now()
     WHERE provider = p_provider
       AND provider_subscription_id = p_provider_subscription_id
     RETURNING id, user_id INTO v_id, v_user;
  ELSE
    -- Cancel at period end. But if there is NO known period end (e.g. an admin comp grant
    -- with current_period_end NULL, which _owned_card_limit treats as perpetual), fall back
    -- to immediate expiry so the Pro cap doesn't persist forever.
    UPDATE billing_subscriptions
       SET status = CASE WHEN current_period_end IS NULL THEN 'expired' ELSE 'canceled' END,
           cancel_at_period_end = (current_period_end IS NOT NULL),
           updated_at = now()
     WHERE provider = p_provider
       AND provider_subscription_id = p_provider_subscription_id
     RETURNING id, user_id INTO v_id, v_user;
  END IF;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user,
    'status', CASE WHEN COALESCE(p_immediate, false) THEN 'expired' ELSE 'canceled' END,
    'immediate', COALESCE(p_immediate, false));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_subscription(text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_subscription(text, text, boolean) TO authenticated;

-- ── 6) admin_adjust_wallet() — support credit / claw-back on the AI wallet ─────
-- Delegates to add_ai_credits (mig 114) with a unique 'admin:'-prefixed ref so the
-- adjustment is auditable in ai_credit_ledger and idempotent per ref. Positive delta
-- credits the wallet; a negative delta is a claw-back.
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
    p_user        uuid,
    p_delta_micro bigint,
    p_reason      text DEFAULT 'admin_adjustment')
  RETURNS json
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bal bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_user IS NULL OR p_delta_micro IS NULL OR p_delta_micro = 0 THEN
    RAISE EXCEPTION 'Invalid wallet adjustment' USING errcode = 'invalid_parameter_value';
  END IF;

  -- Write balance + ledger DIRECTLY (both credit AND claw-back) — self-contained so it
  -- never depends on add_ai_credits (which rejects delta<=0). The balance>=0 CHECK was
  -- dropped (mig 115), so a support deduction may dip the balance negative.
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (p_user, p_delta_micro)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  -- reason is CHECK-constrained; use the fixed allowed value (delta sign = credit/debit).
  -- p_reason stays a param for audit logging on the client but is not stored here.
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (p_user, p_delta_micro, 'admin_adjustment',
            'admin:' || gen_random_uuid()::text, v_bal);

  RETURN json_build_object('ok', true, 'balance_micro', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, bigint, text) TO authenticated;
