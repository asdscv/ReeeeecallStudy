-- ============================================================================
-- 129: Raise subscription DISPLAY prices to match the new plan pricing.
--   sub_5k_monthly        $1.99 → $3.99   (price_usd_cents 199 → 399)
--   sub_unlimited_monthly $9.99 → $19.99  (price_usd_cents 999 → 1999)
-- Credit packs ($0.99/$4.99/$9.99) are UNCHANGED.
--
-- Display-only: PlanSelector + landing PricingSection + get_public_plans read
-- price_usd_cents (mig 128), so the app/landing update automatically on the next
-- fetch. The ACTUAL charge amount lives on the provider product (LemonSqueezy
-- variant price for web; App Store / Play IAP tier for mobile) and must be set to
-- the SAME figure there — grants key off the variant→product map / card_limit,
-- never this price, so a mismatch only misleads the buyer, it can't misgrant.
-- Idempotent (plain UPDATE by id).
-- ============================================================================

UPDATE public.billing_products SET price_usd_cents = 399  WHERE id = 'sub_5k_monthly';
UPDATE public.billing_products SET price_usd_cents = 1999 WHERE id = 'sub_unlimited_monthly';
