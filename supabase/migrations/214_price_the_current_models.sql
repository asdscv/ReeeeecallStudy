-- 214: a model with no price row charges the learner 43x.
--
-- `_ai_resolve_rate` returns nothing for a model that is not in `ai_pricing_config`, and the
-- charge paths then fall back to `ai_pricing_settings.fallback_in/out_micro_usd` — $5.00 and
-- $15.00 per million tokens, chosen to be pessimistic so MARGIN reporting never flatters
-- itself. `112_ai_cost_margin.sql:104` says that fallback is "decoupled from charging — never
-- affects what was charged", and for the free-quota card path that is true. It is NOT true of
-- the actual-cost paths: remediation and quiz both price from measured cost, so an unpriced
-- model multiplies what the learner pays.
--
-- Measured on production the moment the primary moved to `gemini-3.1-flash-lite`, which had no
-- row here:
--
--     in=1041 out=324  cost=10065  price=50325  rate_missing=true
--
-- The same call under flash-lite's real rate is ~234 micro of cost and ~1,170 of price. Every
-- explanation was billed at roughly forty-three times its price for as long as the model was
-- unpriced. Nine calls on one test account; no real learner was charged.
--
-- ## The rates below
--
-- Seeded at the same tier as each model's predecessor and labelled as indicative, exactly like
-- the rows already here. They are a floor for correctness, not an invoice: `rate_missing` is
-- what tells us a rate was guessed, and rows 1-5 carry the same caveat in their own note.
-- CONFIRM AGAINST GOOGLE'S PUBLISHED LIST before treating the margin reports as authoritative.
--
-- `gemini-flash-lite-latest` is an ALIAS that Google repoints over time. It is priced here so
-- it can never be the unpriced case, but it is deliberately the last fallback: an alias whose
-- price can change under us is not something to make primary.
BEGIN;

INSERT INTO public.ai_pricing_config (provider, model, in_micro_usd_per_mtok, out_micro_usd_per_mtok, note)
VALUES
  -- Successor to gemini-2.5-flash-lite, same product tier, seeded at its rate.
  ('gemini', 'gemini-3.1-flash-lite', 100000, 400000,
   'seed: indicative, same tier as gemini-2.5-flash-lite — CONFIRM against list price'),
  ('gemini', 'gemini-flash-lite-latest', 100000, 400000,
   'seed: indicative, alias tracks the flash-lite tier — CONFIRM against list price'),
  -- In the vision chain and reachable, so it must not be the unpriced case either.
  ('gemini', 'gemini-flash-latest', 300000, 2500000,
   'seed: indicative, alias tracks the flash tier — CONFIRM against list price')
ON CONFLICT DO NOTHING;

-- A guard rail, not a rate: surface every model the chain can reach that has no price row, so
-- the next model swap cannot silently multiply what a learner pays. Read by the admin margin
-- screen and cheap enough to scan.
CREATE OR REPLACE FUNCTION public.ai_unpriced_models()
  RETURNS TABLE (provider text, model text, calls bigint, charged_micros bigint, since timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT l.provider, l.model, count(*)::bigint,
           COALESCE(sum(l.price_won_micros), 0)::bigint, min(l.created_at)
      FROM ai_cost_ledger l
     WHERE l.rate_missing
       AND l.created_at > now() - interval '30 days'
     GROUP BY l.provider, l.model
     ORDER BY 4 DESC
  $$;
REVOKE EXECUTE ON FUNCTION public.ai_unpriced_models() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_unpriced_models() TO service_role;

COMMENT ON FUNCTION public.ai_unpriced_models() IS
  'Models billed at the pessimistic fallback because ai_pricing_config has no row. Non-empty '
  'means someone is being overcharged: add the rate.';

COMMIT;
