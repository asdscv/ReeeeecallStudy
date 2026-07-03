-- ============================================================================
-- 128: USD pricing for the billing catalog.
--
-- The LemonSqueezy store (SapioTrix) charges in USD, so the app must DISPLAY USD
-- to match what customers actually pay. Until now billing_products only carried
-- `price_krw` (a ₩ placeholder) which the web PlanSelector / landing PricingSection
-- rendered with a hard-coded ₩ symbol — a global, USD-charging store must not show
-- ₩ prices.
--
-- This migration is DISPLAY-ONLY and changes NO grant logic:
--   * add `price_usd_cents` (integer, USD minor unit) and populate the 5 catalog rows
--     to match the live LemonSqueezy products:
--        credits_1000  $0.99   credits_5000  $4.99   credits_10000 $9.99
--        sub_5k_monthly $1.99   sub_unlimited_monthly $9.99
--   * refresh the credit-pack titles to their USD label (subscription titles stay
--     plan NAMES, not prices).
--   * extend get_billing_products() + get_public_plans() to return price_usd_cents.
--
-- price_krw is KEPT (still snapshotted into payment_intents.amount_krw and used by
-- admin MRR); it is now a legacy/internal field. Entitlement grants key off the
-- variant→product map (webhook) + credits_micro_won / card_limit, never the price,
-- so amounts here never need to match the provider charge for correctness.
--
-- Additive / idempotent: ADD COLUMN IF NOT EXISTS + UPDATE + CREATE OR REPLACE only.
-- ============================================================================

ALTER TABLE public.billing_products
  ADD COLUMN IF NOT EXISTS price_usd_cents integer;

-- Populate USD prices to match the live LemonSqueezy variants (1:1 by product).
UPDATE public.billing_products SET
  price_usd_cents = CASE id
    WHEN 'credits_1000'         THEN 99
    WHEN 'credits_5000'         THEN 499
    WHEN 'credits_10000'        THEN 999
    WHEN 'sub_5k_monthly'        THEN 199
    WHEN 'sub_unlimited_monthly' THEN 999
    ELSE price_usd_cents
  END,
  title = CASE id
    WHEN 'credits_1000'  THEN '$0.99'
    WHEN 'credits_5000'  THEN '$4.99'
    WHEN 'credits_10000' THEN '$9.99'
    ELSE title            -- subscription titles are plan NAMES, keep them
  END
WHERE id IN ('credits_1000','credits_5000','credits_10000','sub_5k_monthly','sub_unlimited_monthly');

-- get_billing_products() — now also returns price_usd_cents (authenticated catalog).
CREATE OR REPLACE FUNCTION public.get_billing_products()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT id, kind, title, price_krw, price_usd_cents, credits_micro_won,
           tier, card_limit, period, sort_order, is_active
    FROM billing_products
    WHERE is_active
    ORDER BY sort_order, id
  ) p;
$$;
REVOKE EXECUTE ON FUNCTION public.get_billing_products() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_billing_products() TO authenticated;

-- get_public_plans() — public landing pricing; add price_usd_cents (still no
-- sensitive fields). Subscriptions only, ordered by sort_order.
CREATE OR REPLACE FUNCTION public.get_public_plans()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT id, title, price_krw, price_usd_cents, card_limit, period
    FROM billing_products
    WHERE kind = 'subscription' AND is_active
    ORDER BY sort_order, id
  ) p;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_plans() TO anon, authenticated;
