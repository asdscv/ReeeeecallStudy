-- ============================================================================
-- 115: Metered-billing hardening (audit follow-up to mig 114).
--
-- refresh_ai_est_price() — calibrate est_price_per_card_micro (the UI-quote seam,
-- seeded ₩2) from the trailing-30d REAL per-paid-card price. The audit noted the
-- seed over-quotes; this refreshes it from ai_cost_ledger. service_role/admin only,
-- excludes estimated rows (no feedback loop), divide-by-zero safe.
--
-- NOTE — a `reconcile_ai_charges` sweep (recover charges lost when the best-effort
-- post-gen charge is swallowed after a 200) was DESIGNED here but DROPPED after the
-- adversarial audit: with no delivery marker on ai_generation_jobs, a genuinely
-- FAILED gen whose release was ALSO swallowed is indistinguishable from a
-- succeeded-but-charge-lost job (both: charged=false, refunded=false, paid>0), so
-- a blind sweep would WRONG-CHARGE a failed generation. We instead prevent lost
-- charges proactively with an inline charge retry in the edge fn (ai-generate),
-- and eat the rare²-residual as UNDER-charge — never wrong-charge (fail-safe).
-- A safe reconcile would need an explicit delivery marker; defer until real data
-- justifies the added success-path write.
--
-- Additive; does NOT touch the reserve/charge/release path. Depends on 114.
-- ============================================================================
BEGIN;

-- Calibrate the UI-quote est-price from the trailing real per-paid-card price.
-- Volume-weighted (sum/sum), so a tiny job doesn't skew the quote as much as a big one.
CREATE OR REPLACE FUNCTION public.refresh_ai_est_price()
  RETURNS bigint  -- the est price after refresh (micro-WON)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_new bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  SELECT (sum(l.price_won_micros) / NULLIF(sum(j.paid_cards), 0))::bigint INTO v_new
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE NOT l.estimated AND l.price_won_micros > 0 AND j.paid_cards > 0
    AND l.created_at > now() - interval '30 days';
  IF v_new IS NOT NULL AND v_new > 0 THEN
    UPDATE ai_pricing_settings SET est_price_per_card_micro = v_new, updated_at = now() WHERE id = 1;
  END IF;
  RETURN COALESCE(v_new, (SELECT est_price_per_card_micro FROM ai_pricing_settings WHERE id = 1));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_ai_est_price() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_ai_est_price() TO service_role;

COMMIT;
