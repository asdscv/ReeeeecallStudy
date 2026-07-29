-- ============================================================================
-- 148: Cap the top subscription plan at 100,000 cards (was the 2e9 "unlimited" seed).
--
-- Heavy-user abuse guard: the top tier (sub_unlimited_monthly, $19.99/mo) is no longer
-- truly unlimited. It now carries a finite 100,000 owned-card ceiling like any other
-- plan — 100,000 is BELOW the 1e9 display/enforcement sentinel, so:
--   * _owned_card_over_cap (mig 136) stops short-circuiting → the cap is enforced;
--   * the client "무제한 / Unlimited" display (>= 1e9) no longer fires for this plan.
--
-- Supersedes the mig-124 seed row (title 'Unlimited', card_limit 2,000,000,000). The
-- 2e9 sentinel remains ONLY for admins (mig 139 _owned_card_limit CASE), who stay
-- uncapped. Title is relabeled 'Unlimited' -> '100,000 cards' for honest UI (mirrors the
-- sibling '5,000 cards' plan).
--
-- Idempotent (safe on re-run / already applied to prod via a direct update).
-- ============================================================================

UPDATE public.billing_products
   SET card_limit = 100000,
       title      = '100,000 cards'
 WHERE id = 'sub_unlimited_monthly';

-- Re-cap any EXISTING active subscription rows granted the old 2e9 limit. (None at write
-- time — no one is on the top plan — but this keeps a rebuild that replays a historical
-- grant correct.) Admins are unaffected: their 2e9 comes from _owned_card_limit's admin
-- branch, not from a billing_subscriptions row.
UPDATE public.billing_subscriptions
   SET card_limit = 100000
 WHERE product_id = 'sub_unlimited_monthly'
   AND card_limit > 100000;
