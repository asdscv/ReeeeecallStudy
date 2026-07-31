-- ============================================================================
-- 150: Unify subscription plan NAMES to "Standard" / "Pro" across web + mobile.
--
-- billing_products.title is the single source of truth every surface reads:
--   * web landing PricingSection (get_public_plans → plan.title),
--   * web + mobile PlanSelector (get_billing_products → p.title),
--   * mobile PaywallScreen (product.title).
-- Until now the top plan carried a card-count title ('5,000 cards' / '100,000 cards',
-- mig 124/148). The owner wants the marketing names "Standard" / "Pro" shown identically
-- on every surface. Because title is a SINGLE string (not an i18n key) it renders the
-- same in every locale — i.e. plan names are proper nouns and are NOT translated, which
-- is the intended behavior.
--
-- No information is lost: every surface still shows the exact card limit separately
-- (card_limit column → "Up to 5,000 cards" / "Up to 100,000 cards"). Nothing parses the
-- title for numbers (verified), and payment mapping keys off variant slug / product id,
-- not the title — so this is display-only.
--
-- Idempotent.
-- ============================================================================

UPDATE public.billing_products SET title = 'Standard' WHERE id = 'sub_5k_monthly';
UPDATE public.billing_products SET title = 'Pro'      WHERE id = 'sub_unlimited_monthly';
