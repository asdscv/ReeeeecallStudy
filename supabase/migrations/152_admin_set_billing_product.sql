-- ============================================================================
-- 152: admin_set_billing_product — edit catalog price / title / card_limit /
--      active WITHOUT a migration or deploy.
--
-- WHY. The owner wants to react to pricing feedback and change subscription (and
-- credit-pack) prices easily. Prices live in two layers:
--   * ACTUAL CHARGE  — on the STORE product (LemonSqueezy variant / App Store / Play).
--     Inherent to Merchant-of-Record + IAP; changed in each store dashboard. (Subscription
--     price changes there grandfather existing subscribers per store policy.)
--   * DISPLAY / GRANT — billing_products (what web landing + PlanSelector show, and what a
--     credit pack GRANTS). Until now this was editable ONLY via a migration.
-- The mobile paywall already shows the LIVE store price (RevenueCat priceString), so mobile
-- DISPLAY auto-syncs. This RPC makes the WEB display + the credit-pack grant a one-call
-- change — no migration, no code deploy, no app rebuild.
--
-- Credit packs: credits_micro_won is kept == price_usd_cents * 10000 (USD face value 1:1,
-- the mig-145 invariant) whenever the price changes, so raising a pack's price raises the
-- credits granted automatically — the owner can never desync price from grant.
--
-- NULL params keep the existing value (COALESCE). Admin/service only (is_admin() gate).
-- Idempotent (CREATE OR REPLACE). Does NOT touch the store — the owner still sets the real
-- charge in the store dashboard; this keeps our side in sync with it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_billing_product(
    p_id              text,
    p_price_usd_cents integer DEFAULT NULL,
    p_title           text    DEFAULT NULL,
    p_card_limit      integer DEFAULT NULL,
    p_sort_order      integer DEFAULT NULL,
    p_is_active       boolean DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.billing_products;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_price_usd_cents IS NOT NULL AND p_price_usd_cents < 0 THEN
    RAISE EXCEPTION 'price_usd_cents must be >= 0' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_card_limit IS NOT NULL AND p_card_limit < 0 THEN
    RAISE EXCEPTION 'card_limit must be >= 0' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE public.billing_products AS bp SET
    price_usd_cents   = COALESCE(p_price_usd_cents, bp.price_usd_cents),
    title             = COALESCE(p_title, bp.title),
    card_limit        = COALESCE(p_card_limit, bp.card_limit),
    sort_order        = COALESCE(p_sort_order, bp.sort_order),
    is_active         = COALESCE(p_is_active, bp.is_active),
    -- credit packs: keep the granted micro-USD == USD face value (1:1) when price changes.
    credits_micro_won = CASE
      WHEN bp.kind = 'credit_pack' AND p_price_usd_cents IS NOT NULL
        THEN p_price_usd_cents::bigint * 10000
      ELSE bp.credits_micro_won END
  WHERE bp.id = p_id
  RETURNING bp.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_id USING errcode = 'invalid_parameter_value';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_billing_product(text,integer,text,integer,integer,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_billing_product(text,integer,text,integer,integer,boolean) TO authenticated, service_role;  -- is_admin() gate in-fn
