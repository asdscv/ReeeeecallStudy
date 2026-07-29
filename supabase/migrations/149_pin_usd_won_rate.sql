-- ============================================================================
-- 149: Pin usd_won_rate = 1 permanently — remove the latent FX-hop over-deduction.
--
-- The AI wallet is single-currency micro-USD (mig 145 rebased balances ÷1350 and set
-- usd_won_rate = 1, dropping the FX layer). But the metering path was left FX-aware:
--   * charge_ai_generation / preview_ai_cost still compute cost * usd_won_rate;
--   * the column DEFAULT was still 1350 (mig 112);
--   * set_ai_pricing_settings still accepted any usd_won_rate in (0, 100000].
-- If usd_won_rate were ever set != 1 (e.g. an admin reverting to 1350, or a fresh
-- settings row taking the old default), EVERY subsequent charge would over/under-deduct
-- from a USD wallet (~1350x) — real user money harm. Since the system is permanently
-- single-currency, enforce usd_won_rate = 1 at the DB layer so the multiply is always
-- identity and no code path (or admin) can break it. No function rewrite needed.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE public.ai_pricing_settings ALTER COLUMN usd_won_rate SET DEFAULT 1;

UPDATE public.ai_pricing_settings SET usd_won_rate = 1 WHERE usd_won_rate IS DISTINCT FROM 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_pricing_settings_usd_won_rate_is_1'
  ) THEN
    ALTER TABLE public.ai_pricing_settings
      ADD CONSTRAINT ai_pricing_settings_usd_won_rate_is_1 CHECK (usd_won_rate = 1);
  END IF;
END $$;
