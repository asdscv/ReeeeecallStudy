-- ============================================================================
-- 124: Subscription PLANS — the real, data-driven card-limit catalog.
--
-- Replaces the single mig-119 placeholder (sub_pro_monthly, card_limit 10000)
-- with the TWO plans we actually sell, added as pure CATALOG ROWS so plans can be
-- added / edited / retired later with a data change ALONE — no function edits:
--
--   * Plan A "5,000 cards" — sub_5k_monthly, tier plan_5k, card_limit 5000,
--     ₩4,900/mo.
--   * Plan B "Unlimited"   — sub_unlimited_monthly, tier plan_unlimited,
--     card_limit 2,000,000,000 (TWO BILLION), ₩9,900/mo.
--
-- WHY 2e9 = "unlimited" WITH ZERO CODE CHANGE:
--   The card-limit machinery already treats card_limit as a plain integer cap:
--     - _owned_card_limit(uid) (mig 119/121) returns the active plan's card_limit,
--       so a subscriber's cap simply becomes 2e9.
--     - check_card_limit (mig 119) blocks only when owned + adding > cap. With a
--       2e9 cap that comparison can never be true for any real library → it never
--       blocks. (Owned-card counts are integer4; 2e9 < int4 max 2,147,483,647, so
--       there is no overflow.)
--     - get_active_card_threshold (mig 123) does OFFSET (_owned_card_limit - 1) =
--       OFFSET (2e9 - 1); nobody owns 2e9 cards, so the OFFSET falls off the end →
--       NO row → threshold NULL → "not over limit" → nothing is ever archived from
--       study. Effectively unlimited.
--   So the sentinel rides the EXISTING integer path — we change data, not logic.
--   Do NOT edit _owned_card_limit / check_card_limit / get_active_card_threshold.
--
-- DISPLAY RULE (the ONLY special-casing, and it is UI-side, not DB): a card_limit
--   >= 1,000,000,000 (1e9) means "unlimited" FOR DISPLAY — render "무제한" /
--   "Unlimited" instead of the raw number. The DB still stores/uses it as a normal
--   huge cap; only the presentation layer collapses big caps to the word.
--
-- RETIRE the old placeholder: sub_pro_monthly → is_active = false (row KEPT for
--   history + any existing billing_subscriptions.product_id FK references; it just
--   drops out of get_billing_products()).
--
-- Additive / idempotent: INSERT ... ON CONFLICT (id) DO UPDATE re-asserts the two
-- plan rows on every run; the sub_pro_monthly deactivation is a plain UPDATE. The
-- billing_products_kind_shape CHECK (mig 120: subscription ⇒ tier + card_limit NOT
-- NULL) is satisfied by both rows.
-- ============================================================================

-- ── 1) The two real plans — 5k before unlimited via sort_order (11 < 12) ────────
-- kind is fixed at insert; ON CONFLICT re-asserts the mutable catalog fields so a
-- re-run always converges to the correct row. credits_micro_won stays NULL
-- (subscriptions mint no credits). sort_order 11/12 sits after the (now inactive)
-- sub_pro_monthly=10 and the credit packs=1..3.
INSERT INTO public.billing_products
  (id, kind, title, price_krw, credits_micro_won, tier, card_limit, period, sort_order, is_active)
VALUES
  ('sub_5k_monthly',        'subscription', '5,000 cards', 4900, NULL, 'plan_5k',        5000,       'monthly', 11, true),
  ('sub_unlimited_monthly', 'subscription', 'Unlimited',   9900, NULL, 'plan_unlimited', 2000000000, 'monthly', 12, true)
ON CONFLICT (id) DO UPDATE SET
  title      = EXCLUDED.title,
  price_krw  = EXCLUDED.price_krw,
  tier       = EXCLUDED.tier,
  card_limit = EXCLUDED.card_limit,
  period     = EXCLUDED.period,
  sort_order = EXCLUDED.sort_order,
  is_active  = EXCLUDED.is_active;

-- ── 2) Retire the mig-119 placeholder (keep the row for history) ────────────────
UPDATE public.billing_products
   SET is_active = false
 WHERE id = 'sub_pro_monthly';
