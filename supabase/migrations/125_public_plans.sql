-- ============================================================================
-- 125: PUBLIC plans RPC — pricing for LOGGED-OUT landing visitors.
--
-- get_billing_products() (mig 119) is authenticated-only (REVOKE FROM anon), so
-- the logged-out landing page at "/" cannot read the plan catalog to render a
-- pricing section. This adds a SEPARATE, deliberately PUBLIC read that exposes
-- ONLY the non-sensitive display fields of the active SUBSCRIPTION plans:
--   id, title, price_krw, card_limit, period.
-- (credits_micro_won, tier, sort_order, is_active, etc. stay private — they're
-- billing internals, not pricing display data.)
--
-- Data-driven: the landing pricing section reads whatever active subscription
-- rows exist here, so adding / editing / retiring a plan is a pure catalog data
-- change (a billing_products row) — NO function or UI edit needed.
--
-- The UNLIMITED sentinel (card_limit = 2e9 for sub_unlimited_monthly, mig 124) is
-- returned as the raw integer; collapsing card_limit >= 1e9 to "무제한"/"Unlimited"
-- is a DISPLAY rule handled client-side, not here.
--
-- SECURITY DEFINER + STABLE + SET search_path=public. GRANT EXECUTE to anon AND
-- authenticated — this is INTENTIONALLY public pricing (no sensitive data), so we
-- do NOT revoke anon here. Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_plans()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT id, title, price_krw, card_limit, period
    FROM billing_products
    WHERE kind = 'subscription' AND is_active
    ORDER BY sort_order, id
  ) p;
$$;

-- Public pricing: readable by everyone, including logged-out landing visitors.
GRANT EXECUTE ON FUNCTION public.get_public_plans() TO anon, authenticated;
