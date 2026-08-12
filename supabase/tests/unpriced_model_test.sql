-- Migration 214: a model with no price row charges the learner 43x.
--
-- `_ai_resolve_rate` returns nothing for a model absent from `ai_pricing_config`, and the
-- charge paths fall back to `fallback_in/out_micro_usd` — $5.00/$15.00 per million tokens,
-- pessimistic on purpose so margin reporting never flatters itself. The comment on that
-- fallback says it "never affects what was charged"; that holds for the free-quota card path
-- and NOT for remediation or quiz, which price from measured cost.
--
-- Measured on production the moment the primary model moved to one with no row:
--
--     in=1041 out=324   cost=10065   price=50325   rate_missing=true
--     …after adding the row:
--     in=1058 out=283   cost=  219   price= 1095   rate_missing=false
--
-- Pinned here:
--   1) every model the provider chain can reach HAS a rate, so the fallback is unreachable
--      through normal operation;
--   2) the fallback is still far above any real rate, so if it is ever reached the ledger
--      shows an obvious anomaly rather than a plausible one;
--   3) `ai_unpriced_models()` reports exactly the calls that hit the fallback, and is not
--      callable by a client.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  -- Every model named in supabase/functions/_shared/ai-providers.ts for the gemini provider.
  c_chain constant text[] := ARRAY[
    'gemini-3.1-flash-lite',      -- text + vision primary
    'gemini-2.5-flash',           -- first fallback, both chains
    'gemini-flash-lite-latest'    -- last text fallback
  ];
  v_model text;
  v_in bigint; v_out bigint;
  s public.ai_pricing_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;

  -- (1) Nothing in the chain may be unpriced.
  FOREACH v_model IN ARRAY c_chain LOOP
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate('gemini', v_model);
    IF v_in IS NULL OR v_out IS NULL THEN
      RAISE EXCEPTION 'FAIL: % has no price row — every call on it bills at the pessimistic fallback (%/% per Mtok)',
        v_model, s.fallback_in_micro_usd, s.fallback_out_micro_usd;
    END IF;
    -- A rate ABOVE the fallback would mean the "safe" default is actually the cheap one.
    IF v_in > s.fallback_in_micro_usd OR v_out > s.fallback_out_micro_usd THEN
      RAISE EXCEPTION 'FAIL: % is priced above the fallback (% / %)', v_model, v_in, v_out;
    END IF;
  END LOOP;

  -- (2) The fallback must stay obviously pessimistic. If someone ever tunes it down to a
  -- realistic number, an unpriced model starts producing a plausible-looking charge, and the
  -- 43x above would have gone unnoticed instead of standing out.
  IF s.fallback_in_micro_usd < 1000000 OR s.fallback_out_micro_usd < 5000000 THEN
    RAISE EXCEPTION 'FAIL: the unpriced fallback (%/%) is close enough to a real rate to hide a missing row',
      s.fallback_in_micro_usd, s.fallback_out_micro_usd;
  END IF;

  -- (3) The reporting function exists and is service-only. A client able to read it learns
  -- nothing dangerous, but it is an admin/ops signal and is granted like one.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ai_unpriced_models') THEN
    RAISE EXCEPTION 'FAIL: ai_unpriced_models() is missing — nothing watches for the next unpriced model';
  END IF;
  IF has_function_privilege('authenticated', 'public.ai_unpriced_models()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ai_unpriced_models()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: ai_unpriced_models() is reachable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ai_unpriced_models()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role cannot read ai_unpriced_models()';
  END IF;

  RAISE NOTICE 'unpriced_model_test: all assertions passed';
END $$;

ROLLBACK;
