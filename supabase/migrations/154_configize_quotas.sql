-- ============================================================================
-- 154: Config-ize growth levers (Pack B) — change without a migration/deploy.
--
-- Was: the AI free daily quota lived as a hardcoded `SELECT 10` in
-- _ai_free_cards_per_day() AND mirrored in two clients → changing one number meant a
-- DB migration + web deploy + mobile OTA (3 coordinated deploys). Now the value lives in
-- ai_pricing_settings and the helper reads it; the clients already read
-- get_ai_generation_quota().free_limit (mig 108), so they follow automatically once they
-- stop hardcoding it. Plus admin setters for the free quota and the owned-card cap
-- (card_limit_settings had no setter — raw SQL only), and the existing AI margin setter is
-- opened to the admin UI (its body is already is_admin-gated).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / GRANT).
-- ============================================================================

-- ── 1) Free daily quota → config column ─────────────────────────────────────
ALTER TABLE public.ai_pricing_settings
  ADD COLUMN IF NOT EXISTS free_cards_per_day integer NOT NULL DEFAULT 10;

-- Read the configured quota. Was IMMUTABLE `SELECT 10`; now STABLE reading the config row
-- (COALESCE keeps the historical 10 if the row/column is somehow absent). Grants are
-- preserved by CREATE OR REPLACE (internal helper; callers are SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public._ai_free_cards_per_day()
  RETURNS integer LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT COALESCE((SELECT free_cards_per_day FROM public.ai_pricing_settings WHERE id = 1), 10)
$$;

-- admin_set_ai_free_quota — the free-tier size (CAC/growth lever) as a one-RPC change.
CREATE OR REPLACE FUNCTION public.admin_set_ai_free_quota(p_free_cards_per_day integer)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_free_cards_per_day IS NULL OR p_free_cards_per_day < 0 OR p_free_cards_per_day > 100000 THEN
    RAISE EXCEPTION 'free_cards_per_day out of range (0..100000)' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE public.ai_pricing_settings SET free_cards_per_day = p_free_cards_per_day, updated_at = now() WHERE id = 1;
  RETURN p_free_cards_per_day;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_ai_free_quota(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_ai_free_quota(integer) TO authenticated, service_role;  -- is_admin() gate in-fn

-- ── 2) Owned-card cap → admin setter (config table had none) ────────────────
CREATE OR REPLACE FUNCTION public.admin_set_card_limit(
    p_max_owned_cards integer DEFAULT NULL,
    p_count_official  boolean DEFAULT NULL)
  RETURNS public.card_limit_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.card_limit_settings;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_max_owned_cards IS NOT NULL AND p_max_owned_cards < 0 THEN
    RAISE EXCEPTION 'max_owned_cards must be >= 0' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE public.card_limit_settings SET
    max_owned_cards      = COALESCE(p_max_owned_cards, max_owned_cards),
    count_official_cards = COALESCE(p_count_official, count_official_cards)
  WHERE id = 1
  RETURNING * INTO r;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_card_limit(integer, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_card_limit(integer, boolean) TO authenticated, service_role;  -- is_admin() gate in-fn

-- ── 3) Open the existing AI margin/pricing setter to the admin UI ───────────
-- set_ai_pricing_settings(won_per_credit, target_margin_bps, usd_won_rate) already gates on
-- is_admin() in-body; it was service_role-only, so the margin knob had no dashboard path.
-- Grant EXECUTE to authenticated so an admin can tune it from the admin page. (usd_won_rate
-- stays pinned to 1 by the mig-149 CHECK; the UI should only expose won_per_credit +
-- target_margin_bps.)
GRANT EXECUTE ON FUNCTION public.set_ai_pricing_settings(integer, integer, numeric) TO authenticated;
