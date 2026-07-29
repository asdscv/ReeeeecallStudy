-- ============================================================================
-- 159: SANDBOX vs PRODUCTION isolation for store-billing events.
--
-- WHY. RevenueCat tags every webhook event with `environment` ('SANDBOX' |
-- 'PRODUCTION'), and we ignored it entirely. That has two consequences the moment
-- a sandbox webhook is enabled — which is exactly what you must do to test IAP:
--
--   1. FREE MONEY. A sandbox purchase costs nothing and is made from a tester
--      account you create yourself, but it flowed through the same grant path as a
--      real one: real micro-USD credited to a real account in the production
--      database. Nothing distinguished it afterwards.
--   2. POISONED METRICS. Those grants and subscriptions landed in the same rows the
--      admin overview counts, so MRR, active-subscription counts and wallet totals
--      silently included test data. A revenue number you cannot trust is worse than
--      no revenue number.
--
-- This migration makes the environment a first-class, recorded property and puts a
-- kill switch in front of sandbox grants, so testing IAP never costs correctness.
--
-- DESIGN.
--   * `environment` is STORED on the rows a store event can create
--     (ai_credit_ledger, billing_subscriptions). payment_intents deliberately has
--     NO column: web checkout is production by construction, and a column that is
--     always the same value is a lie waiting to drift. The admin list emits the
--     literal 'production' for that arm instead.
--   * system_flags.sandbox_grants_enabled (DEFAULT FALSE) gates whether a sandbox
--     event may grant at all. Default-off means enabling the sandbox webhook is
--     safe by itself: events arrive, get acked, and change nothing until an admin
--     deliberately opens the door for a test run.
--   * The admin overview EXCLUDES sandbox from every business metric and reports it
--     separately. Sandbox volume stays visible — it is just never counted as money.
--     Note wallet_total_micro is deliberately NOT adjusted: those credits are
--     genuinely spendable, so the honest number is the full liability plus a
--     separate `sandbox_granted_micro` breakdown.
--
-- Backfill: every existing row predates the sandbox webhook, so it is production.
-- Additive / idempotent. Depends on mig 156 (platform) and mig 153 (system_flags).
-- ============================================================================

-- ── 1) environment columns ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ai_credit_ledger'
                   AND column_name='environment') THEN
    ALTER TABLE public.ai_credit_ledger ADD COLUMN environment text;
    ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_environment_chk
      CHECK (environment IS NULL OR environment IN ('production','sandbox'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='billing_subscriptions'
                   AND column_name='environment') THEN
    ALTER TABLE public.billing_subscriptions ADD COLUMN environment text;
    ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_environment_chk
      CHECK (environment IS NULL OR environment IN ('production','sandbox'));
  END IF;
END $$;

-- Everything that exists today was created before any sandbox webhook could fire.
UPDATE public.ai_credit_ledger      SET environment = 'production' WHERE environment IS NULL;
UPDATE public.billing_subscriptions SET environment = 'production' WHERE environment IS NULL;

-- Partial indexes: sandbox rows are the rare case we filter ON, so index only those.
CREATE INDEX IF NOT EXISTS ai_credit_ledger_sandbox_idx
  ON public.ai_credit_ledger (created_at DESC) WHERE environment = 'sandbox';
CREATE INDEX IF NOT EXISTS billing_subscriptions_sandbox_idx
  ON public.billing_subscriptions (updated_at DESC) WHERE environment = 'sandbox';

-- ── 2) the kill switch ──────────────────────────────────────────────────────
-- DEFAULT FALSE: turning the sandbox webhook on must not, by itself, let test
-- purchases mint credits. An admin opens this for a test run and closes it after.
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS sandbox_grants_enabled boolean NOT NULL DEFAULT false;

-- get_system_flags(): mig 153 body + the new flag, so the admin UI can render it.
CREATE OR REPLACE FUNCTION public.get_system_flags()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT row_to_json(f) FROM (
    SELECT maintenance_mode, maintenance_message, ai_generation_enabled,
           payments_enabled, sandbox_grants_enabled
    FROM public.system_flags WHERE id = 1
  ) f;
$$;
REVOKE EXECUTE ON FUNCTION public.get_system_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_system_flags() TO anon, authenticated, service_role;

-- admin_set_system_flags(): mig 153 body + the new flag. The old 4-arg overload is
-- DROPPED rather than left beside a 5-arg version whose extra parameter has a
-- default — two overloads reachable by the same named-arg call is ambiguous (42725)
-- and would break the existing admin screen.
DROP FUNCTION IF EXISTS public.admin_set_system_flags(boolean, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_set_system_flags(
    p_maintenance_mode       boolean DEFAULT NULL,
    p_maintenance_message    text    DEFAULT NULL,
    p_ai_generation_enabled  boolean DEFAULT NULL,
    p_payments_enabled       boolean DEFAULT NULL,
    p_sandbox_grants_enabled boolean DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.system_flags;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  UPDATE public.system_flags SET
    maintenance_mode       = COALESCE(p_maintenance_mode, maintenance_mode),
    maintenance_message    = COALESCE(p_maintenance_message, maintenance_message),
    ai_generation_enabled  = COALESCE(p_ai_generation_enabled, ai_generation_enabled),
    payments_enabled       = COALESCE(p_payments_enabled, payments_enabled),
    sandbox_grants_enabled = COALESCE(p_sandbox_grants_enabled, sandbox_grants_enabled),
    updated_at             = now()
  WHERE id = 1
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_system_flags(boolean,text,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_system_flags(boolean,text,boolean,boolean,boolean) TO authenticated, service_role;

-- The predicate the webhook asks BEFORE granting. Separate from get_system_flags()
-- so the webhook states its intent in one call and cannot mis-read a wider payload.
CREATE OR REPLACE FUNCTION public.sandbox_grants_enabled()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT sandbox_grants_enabled FROM public.system_flags WHERE id = 1), false);
$$;
REVOKE EXECUTE ON FUNCTION public.sandbox_grants_enabled() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sandbox_grants_enabled() TO service_role;

-- ── 3) tagging setters now carry the environment too ────────────────────────
-- mig 156's three-arg versions are DROPPED, not overloaded: a 4th defaulted
-- parameter beside them makes a three-named-arg call ambiguous (42725).
DROP FUNCTION IF EXISTS public.set_subscription_platform(text, text, text);
DROP FUNCTION IF EXISTS public.set_credit_grant_platform(text, text);

CREATE OR REPLACE FUNCTION public.set_subscription_platform(
    p_provider                 text,
    p_provider_subscription_id text,
    p_platform                 text,
    p_environment              text DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to set subscription platform' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_environment IS NOT NULL AND p_environment NOT IN ('production','sandbox') THEN
    RAISE EXCEPTION 'Invalid environment: %', p_environment USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_platform IS NULL AND p_environment IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'nothing_to_set');
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  -- COALESCE-on-write: a NULL argument never blanks a value we already know.
  UPDATE public.billing_subscriptions
     SET platform    = COALESCE(p_platform, platform),
         environment = COALESCE(p_environment, environment),
         updated_at  = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
     AND (platform    IS DISTINCT FROM COALESCE(p_platform, platform)
       OR environment IS DISTINCT FROM COALESCE(p_environment, environment));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count,
                           'platform', p_platform, 'environment', p_environment);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_subscription_platform(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_subscription_platform(text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_credit_grant_platform(
    p_ref         text,
    p_platform    text,
    p_environment text DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to set credit grant platform' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_environment IS NOT NULL AND p_environment NOT IN ('production','sandbox') THEN
    RAISE EXCEPTION 'Invalid environment: %', p_environment USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_platform IS NULL AND p_environment IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'nothing_to_set');
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RAISE EXCEPTION 'ref required' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE public.ai_credit_ledger
     SET platform    = COALESCE(p_platform, platform),
         environment = COALESCE(p_environment, environment)
   WHERE ref = p_ref
     AND delta > 0
     AND (platform    IS DISTINCT FROM COALESCE(p_platform, platform)
       OR environment IS DISTINCT FROM COALESCE(p_environment, environment));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count,
                           'platform', p_platform, 'environment', p_environment);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_credit_grant_platform(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_credit_grant_platform(text,text,text) TO service_role;

-- ── 4) admin_billing_overview — sandbox never counts as money ───────────────
-- mig 145's body, with every business metric restricted to production and the
-- sandbox volume reported alongside instead of hidden. wallet_total_micro stays
-- unadjusted on purpose (see header) and gets a sandbox breakdown next to it.
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
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'active' AND environment IS DISTINCT FROM 'sandbox'),
    'canceling',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE cancel_at_period_end = true AND environment IS DISTINCT FROM 'sandbox'),
    'past_due',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'past_due' AND environment IS DISTINCT FROM 'sandbox'),
    'mrr_micro_won',
      COALESCE((
        SELECT SUM(p.price_usd_cents::bigint * 10000)
        FROM billing_subscriptions s
        JOIN billing_products p ON p.id = s.product_id
        WHERE s.status = 'active' AND s.environment IS DISTINCT FROM 'sandbox'
      ), 0),
    -- The full spendable liability, test credits included — those really can be
    -- spent, so netting them out here would understate what we owe.
    'wallet_total_micro',
      COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    'paid_revenue_30d_micro',
      COALESCE((
        SELECT SUM(COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0))
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.status = 'paid' AND pi.paid_at > now() - interval '30 days'
      ), 0),
    'refunds_30d',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'refunded' AND updated_at > now() - interval '30 days'
          AND environment IS DISTINCT FROM 'sandbox'),
    -- ── sandbox, reported not hidden ──
    'sandbox_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE environment = 'sandbox'),
    'sandbox_granted_micro',
      COALESCE((SELECT SUM(delta) FROM ai_credit_ledger
                 WHERE environment = 'sandbox' AND delta > 0), 0),
    'sandbox_grants_enabled', public.sandbox_grants_enabled()
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_billing_overview() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_billing_overview() TO authenticated;

-- ── 5) admin lists surface the environment ──────────────────────────────────
-- Without this the isolation is invisible: an admin looking at a row could not
-- tell a test purchase from a real one, which is exactly the confusion that made
-- silent sandbox grants dangerous in the first place.
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
           s.cancel_at_period_end, s.created_at, s.updated_at,
           s.platform,
           COALESCE(s.environment, 'production') AS environment,
           public._billing_channel(s.platform, s.provider) AS channel,
           public._channel_has_money_api(
             public._billing_channel(s.platform, s.provider)) AS can_refund_money
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

-- mig 156's body + environment. The payment_intents arm emits the literal
-- 'production': web checkout has no sandbox mode, which is why that table has no
-- column to read (see header).
CREATE OR REPLACE FUNCTION public.admin_list_payments(
    p_limit    integer DEFAULT 50,
    p_offset   integer DEFAULT 0,
    p_platform text    DEFAULT NULL)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT * FROM (
      SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
             pi.amount_krw,
             COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
             pi.status, pi.provider, pi.provider_payment_id,
             pi.paid_at, pi.created_at,
             pi.platform,
             'production'::text AS environment,
             public._billing_channel(pi.platform, pi.provider) AS channel,
             public._channel_has_money_api(
               public._billing_channel(pi.platform, pi.provider)) AS can_refund_money
      FROM payment_intents pi
      LEFT JOIN auth.users u ON u.id = pi.user_id
      LEFT JOIN billing_products bp ON bp.id = pi.product_id
      WHERE p_platform IS NULL OR pi.platform = p_platform

      UNION ALL

      SELECT l.ref AS merchant_uid, l.user_id, u.email, NULL::text AS product_id,
             'credit_pack'::text AS kind,
             NULL::integer AS amount_krw,
             l.delta::bigint AS amount_micro,
             'paid'::text AS status,
             'revenuecat'::text AS provider,
             l.ref AS provider_payment_id,
             l.created_at AS paid_at, l.created_at,
             l.platform,
             COALESCE(l.environment, 'production') AS environment,
             public._billing_channel(l.platform, 'revenuecat') AS channel,
             public._channel_has_money_api(
               public._billing_channel(l.platform, 'revenuecat')) AS can_refund_money
      FROM ai_credit_ledger l
      LEFT JOIN auth.users u ON u.id = l.user_id
      WHERE l.delta > 0
        AND l.reason = 'purchase'
        AND l.ref IS NOT NULL
        AND (l.ref LIKE 'rc:%' OR l.ref LIKE 'rcev:%')
        AND (p_platform IS NULL OR l.platform = p_platform)
    ) unioned
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) TO authenticated;
