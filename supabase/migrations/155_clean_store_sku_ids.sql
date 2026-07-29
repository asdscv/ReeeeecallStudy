-- ============================================================================
-- 155: Converge billing_product_skus to the FINAL clean store ids (subscriptions).
--
-- Records in version control a change that had only been applied to prod directly
-- (via set_store_product_sku / service-role SQL) on 2026-07-27, so a DB rebuilt
-- from migrations reproduces the live catalog instead of mig-151's placeholder
-- v2/v3 seeds.
--
-- CONSUMABLES were already seeded clean in mig 151 (ai_credit_099/499/999) — untouched.
--
-- ⚠️ iOS AND ANDROID SUBSCRIPTION STORE IDS DIFFER — this is intentional & permanent:
--
--   internal billing_products.id | iOS App Store id  | Google Play id
--   ─────────────────────────────┼───────────────────┼──────────────────────────────
--   sub_5k_monthly  (Standard)   | standard_monthly  | sub_standard_monthly:monthly
--   sub_unlimited_monthly (Pro)  | pro_monthly       | sub_pro_monthly:monthly
--
-- WHY iOS uses the un-prefixed `standard_monthly`/`pro_monthly` instead of the tidy
-- `sub_standard_monthly`/`sub_pro_monthly` that Google uses: those two ids were
-- created then deleted on App Store Connect, and **Apple PERMANENTLY reserves a
-- deleted product id** (recreating one → 409 "product ID has already been used").
-- They are burned forever, so iOS fell back to the un-prefixed form. Do NOT attempt
-- to "restore" sub_*_monthly on iOS — it is impossible. Google Play ids keep the
-- sub_*_monthly:<basePlan> form. The per-platform SKU map (this table) + RevenueCat
-- absorb the divergence; nothing app-side hardcodes these strings (client reads them
-- from get_billing_products(Platform.OS)). See memory project-mobile-iap.
--
-- Internal billing_products.id NEVER changes (ledger/intents reference them); only the
-- store SKU + this mapping do. Idempotent: converges to the final state from any start.
-- ============================================================================

-- Retire EVERY existing SKU row for the two subscription products on both platforms
-- (mig-151 placeholders sub_5k_monthly_v2 / sub_unlimited_monthly_v3, plus any interim
-- ids), so the unique-active index (platform, product_id) WHERE is_active never trips
-- when we activate the clean ids below. History rows are kept (is_active=false).
UPDATE public.billing_product_skus
   SET is_active = false, updated_at = now()
 WHERE product_id IN ('sub_5k_monthly','sub_unlimited_monthly')
   AND is_active;

-- Upsert the FINAL clean store ids as the single active SKU per (platform, product).
INSERT INTO public.billing_product_skus (platform, store_product_id, product_id, is_active) VALUES
  ('ios',     'standard_monthly',             'sub_5k_monthly',        true),
  ('ios',     'pro_monthly',                  'sub_unlimited_monthly', true),
  ('android', 'sub_standard_monthly:monthly', 'sub_5k_monthly',        true),
  ('android', 'sub_pro_monthly:monthly',      'sub_unlimited_monthly', true)
ON CONFLICT (platform, store_product_id)
  DO UPDATE SET product_id = EXCLUDED.product_id,
                is_active   = true,
                updated_at  = now();
