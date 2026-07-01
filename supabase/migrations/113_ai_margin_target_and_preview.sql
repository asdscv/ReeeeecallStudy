-- ============================================================================
-- 113: Set the margin TARGET to 80% + net-zero floor monitoring + a dry-run RPC.
--
-- Owner business input: keep ~80% margin, with a NET-ZERO floor (never sell a
-- PAID generation below cost). Both are monitor-only — the layer stays
-- observational (fixed credits), so this changes NO charging behavior:
--   * target_margin_bps → 8000 (was 7000). `under_target` (soft) now means <80%.
--   * get_ai_margin_daily gains under_target_jobs + net_negative_jobs (the hard
--     net-zero floor = a PAID row priced below its real cost).
--   * preview_ai_cost(...) — a read-only DRY RUN of the exact finalize math for
--     any (provider, model, tokens, credits), so the owner can preview margins
--     before committing a rate / ₩-per-credit, without writing a ledger row.
--
-- Depends on 112. Additive; the charging path (108-111) remains untouched.
-- ============================================================================

-- ── 1) Margin target → 80% (default + the live row) ──
ALTER TABLE public.ai_pricing_settings ALTER COLUMN target_margin_bps SET DEFAULT 8000;
UPDATE public.ai_pricing_settings SET target_margin_bps = 8000, updated_at = now() WHERE id = 1;

-- ── 2) Dry-run: compute cost/price/margin/net-status WITHOUT writing a row ──
-- Mirrors finalize_ai_cost's math but takes credits directly + returns the result.
-- Lets the owner preview "at rate X and ₩/credit Y, what's the margin for this
-- model at N tokens?" before committing. Admin / service_role only.
CREATE OR REPLACE FUNCTION public.preview_ai_cost(
    p_provider text, p_model text, p_tokens_in integer, p_tokens_out integer, p_credits integer)
  RETURNS TABLE (
    cost_usd_micros bigint, cost_won_micros bigint, price_won_micros bigint,
    margin_won_micros bigint, margin_bps integer,
    rate_missing boolean, estimated boolean, under_target boolean, net_negative boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint; v_cost_won bigint; v_price bigint; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_price := COALESCE(p_credits, 0)::bigint * s.won_per_credit * 1000000;

  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    RETURN QUERY SELECT NULL::bigint, NULL::bigint, v_price, NULL::bigint, NULL::integer,
      false, true, false, false;
    RETURN;
  END IF;

  SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
  IF NOT FOUND OR v_in IS NULL THEN
    v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
  END IF;

  v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
  v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  v_margin   := v_price - v_cost_won;
  v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;

  RETURN QUERY SELECT v_cost_usd, v_cost_won, v_price, v_margin, v_bps,
    v_missing, false,
    (v_bps IS NOT NULL AND v_bps < s.target_margin_bps),            -- under 80% target (soft)
    (v_price > 0 AND v_margin < 0);                                 -- net-zero floor breach (hard, PAID only)
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer, integer)
  TO service_role;

-- ── 3) Rollup gains under_target_jobs (soft, <80%) + net_negative_jobs (hard, PAID below cost) ──
-- Signature changes (new columns) → DROP + CREATE. net_negative counts only PAID
-- rows below cost (free-tier CAC is intentionally negative and excluded).
DROP FUNCTION IF EXISTS public.get_ai_margin_daily(date);
CREATE FUNCTION public.get_ai_margin_daily(
    p_since date DEFAULT (now() - interval '30 days')::date)
  RETURNS TABLE (day date, provider text, model text, jobs bigint,
                 unknown_cost_jobs bigint, rate_missing_jobs bigint,
                 under_target_jobs bigint, net_negative_jobs bigint,
                 price_won_micros numeric, cost_won_micros numeric,
                 margin_won_micros numeric, realized_margin_ratio numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    date_trunc('day', l.created_at)::date AS day,
    l.provider, l.model,
    count(*)::bigint,
    count(*) FILTER (WHERE l.estimated)::bigint,
    count(*) FILTER (WHERE l.rate_missing)::bigint,
    count(*) FILTER (WHERE l.under_target)::bigint,                                   -- soft: <80% target
    count(*) FILTER (WHERE NOT l.estimated AND l.price_won_micros > 0
                       AND l.margin_won_micros < 0)::bigint,                          -- hard: PAID below cost
    COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
             FILTER (WHERE NOT l.estimated), 0)::numeric,
    COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0)::numeric,
    (COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
              FILTER (WHERE NOT l.estimated), 0)
     - COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric,
    round(1.0 - (COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric
          / NULLIF(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
                   FILTER (WHERE NOT l.estimated), 0), 4)
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE l.created_at::date >= p_since
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 2, 3;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_margin_daily(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_margin_daily(date) TO authenticated, service_role;  -- is_admin() gate in-fn
