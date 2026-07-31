-- ============================================================================
-- 151: DB-centric store-SKU catalog — single source of truth for the mapping
--      between a STORE product identifier and our internal billing_products.id.
--
-- WHY. Until now that mapping lived scattered across env secrets + a client
-- assumption, so adding/rotating a store product meant editing secrets and
-- redeploying/rebuilding:
--   * REVENUECAT_PRODUCT_MAP   (edge secret)  store IAP id  -> billing_products.id
--   * LEMONSQUEEZY_VARIANT_MAP (edge secret)  LS variant id -> billing_products.id
--   * mobile findPackageForProduct ASSUMED the RevenueCat package identifier
--     EQUALS our internal id (dashboard-config discipline; fragile).
--
-- This migration moves that mapping into ONE table keyed to billing_products,
-- so registering/rotating a store product is a single row (or a set_store_product_sku
-- call) — no secret edit, no redeploy, no app rebuild. The edge functions read it
-- DB-first and keep the env maps as a backward-compatible FALLBACK, so the already
-- live web (LemonSqueezy) flow is untouched until rows are seeded.
--
-- The internal billing_products.id values NEVER change (ledger/intents reference
-- them); only the store SKU (a layer below) and this mapping do. Credit grant =
-- USD face value 1:1 was already set in mig 145 (credits_micro_won = usd_cents*1e4).
--
-- Concrete trigger: the App Store / Play credit packs were created as the WRONG
-- product type (non-consumable = one-time buy, can't re-top-up). They must be
-- recreated as CONSUMABLE with NEW store ids (Apple permanently reserves a used
-- id + can't change its type). New ids: ai_credit_099/499/999 (seeded below).
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING.
-- ============================================================================

-- ── 1) billing_product_skus — the store SKU ↔ internal product map ──────────
CREATE TABLE IF NOT EXISTS public.billing_product_skus (
  platform          text    NOT NULL
                            CHECK (platform IN ('ios','android','lemonsqueezy','toss')),
  store_product_id  text    NOT NULL,   -- App Store / Play product id, LS variant id, …
  product_id        text    NOT NULL REFERENCES public.billing_products(id),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, store_product_id)
);
-- Exactly one ACTIVE store SKU per (platform, internal product): rotating a SKU keeps
-- the old row for history (is_active=false) while the new one is the single live target.
CREATE UNIQUE INDEX IF NOT EXISTS billing_product_skus_one_active_per_product
  ON public.billing_product_skus (platform, product_id) WHERE is_active;

ALTER TABLE public.billing_product_skus ENABLE ROW LEVEL SECURITY;
-- Deny-all to clients: no SELECT/write policy. The client only ever sees its platform's
-- SKU via get_billing_products(platform) (SECURITY DEFINER); webhooks read via the
-- service role. So REVOKE all client grants and hand full access to service_role only.
REVOKE ALL ON public.billing_product_skus FROM anon, authenticated;
GRANT  ALL ON public.billing_product_skus TO service_role;

-- ── 2) resolve_store_product — store SKU -> internal billing_products.id ─────
-- Webhook-side resolver (service_role). Returns the internal product id for an active
-- store SKU, or NULL when unknown OR AMBIGUOUS (more than one internal product maps to
-- the same store id for the queried scope) — the caller then falls back to the env map
-- or rejects, never guesses. p_platform NULL = match any platform (RevenueCat events may
-- omit the store); still only resolves when the internal id is unambiguous.
CREATE OR REPLACE FUNCTION public.resolve_store_product(
    p_platform text, p_store_product_id text)
  RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ids text[];
BEGIN
  IF p_store_product_id IS NULL OR p_store_product_id = '' THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT product_id) INTO v_ids
  FROM billing_product_skus
  WHERE is_active
    AND store_product_id = p_store_product_id
    AND (p_platform IS NULL OR platform = p_platform);
  IF v_ids IS NULL OR array_length(v_ids, 1) <> 1 THEN
    RETURN NULL;  -- unknown or ambiguous
  END IF;
  RETURN v_ids[1];
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_store_product(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_store_product(text, text) TO service_role;

-- ── 3) set_store_product_sku — admin/service UPSERT (no migration to add a SKU) ──
-- Lets the owner register/rotate a store SKU without a code change: e.g. the LIVE
-- LemonSqueezy variant id (unknown until store activation, differs from test mode), or a
-- new consumable App Store/Play id. Rotating: call with the new id (its unique-active
-- index makes it the live target); deactivate an old one with p_is_active=false.
CREATE OR REPLACE FUNCTION public.set_store_product_sku(
    p_platform text, p_store_product_id text, p_product_id text,
    p_is_active boolean DEFAULT true)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF p_platform IS NULL OR p_store_product_id IS NULL OR p_product_id IS NULL
     OR p_store_product_id = '' OR p_product_id = '' THEN
    RAISE EXCEPTION 'platform, store_product_id and product_id are required'
      USING errcode = 'invalid_parameter_value';
  END IF;
  -- FK on product_id (below) rejects an unknown internal product; the platform CHECK
  -- rejects an unknown platform. When activating, retire any other active SKU for the
  -- same (platform, product) first so the unique-active index never trips.
  IF p_is_active THEN
    UPDATE billing_product_skus
       SET is_active = false, updated_at = now()
     WHERE platform = p_platform AND product_id = p_product_id
       AND store_product_id <> p_store_product_id AND is_active;
  END IF;
  INSERT INTO billing_product_skus (platform, store_product_id, product_id, is_active)
  VALUES (p_platform, p_store_product_id, p_product_id, p_is_active)
  ON CONFLICT (platform, store_product_id)
  DO UPDATE SET product_id = EXCLUDED.product_id,
               is_active   = EXCLUDED.is_active,
               updated_at  = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_store_product_sku(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_store_product_sku(text, text, text, boolean) TO service_role;

-- ── 4) get_billing_products(p_platform) — catalog + this platform's store SKU ──
-- New OVERLOAD (the no-arg mig-128 version is left intact, so the web client that calls
-- get_billing_products() is 100% unchanged). The mobile client calls this one with its
-- Platform.OS so each product carries the exact store_product_id to purchase — removing
-- the "RevenueCat package identifier == internal id" assumption. store_product_id is null
-- for a product with no active SKU on that platform.
CREATE OR REPLACE FUNCTION public.get_billing_products(p_platform text)
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT bp.id, bp.kind, bp.title, bp.price_krw, bp.price_usd_cents, bp.credits_micro_won,
           bp.tier, bp.card_limit, bp.period, bp.sort_order, bp.is_active,
           sku.store_product_id
    FROM billing_products bp
    LEFT JOIN LATERAL (
      SELECT s.store_product_id
      FROM billing_product_skus s
      WHERE s.product_id = bp.id AND s.platform = p_platform AND s.is_active
      LIMIT 1
    ) sku ON true
    WHERE bp.is_active
    ORDER BY bp.sort_order, bp.id
  ) p;
$$;
REVOKE EXECUTE ON FUNCTION public.get_billing_products(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_billing_products(text) TO authenticated;

-- ── 5) Seed the mobile store SKUs ───────────────────────────────────────────
-- Credit packs: the NEW consumable ids (recreated in App Store Connect / Play as
-- Consumable so they can be re-purchased). iOS and Android share the same id by
-- convention. Subscriptions: the EXISTING store ids (unchanged) recorded here so the
-- RevenueCat webhook can resolve them from the DB too. LemonSqueezy (web) is NOT seeded
-- — its live variant ids are owner-only + change at store activation, so the owner
-- registers them with set_store_product_sku('lemonsqueezy', <variant id>, <product id>);
-- until then the lemonsqueezy webhooks keep using the LEMONSQUEEZY_VARIANT_MAP fallback.
INSERT INTO public.billing_product_skus (platform, store_product_id, product_id) VALUES
  ('ios',     'ai_credit_099',          'credits_1000'),
  ('ios',     'ai_credit_499',          'credits_5000'),
  ('ios',     'ai_credit_999',          'credits_10000'),
  ('ios',     'sub_5k_monthly_v2',      'sub_5k_monthly'),
  ('ios',     'sub_unlimited_monthly_v3','sub_unlimited_monthly'),
  ('android', 'ai_credit_099',          'credits_1000'),
  ('android', 'ai_credit_499',          'credits_5000'),
  ('android', 'ai_credit_999',          'credits_10000'),
  ('android', 'sub_5k_monthly_v2',      'sub_5k_monthly'),
  ('android', 'sub_unlimited_monthly_v3','sub_unlimited_monthly')
ON CONFLICT (platform, store_product_id) DO NOTHING;
