-- Rollback 217: put the misleading names back.
--
-- Only the column renames are reversed. The function bodies are NOT restored, because they were
-- rewritten by substitution from their own live definitions and re-running the earlier
-- migrations is the way back to those. In practice you would not want this file: the names were
-- wrong, nothing about the values changed, and reverting reintroduces columns that say "won"
-- while holding micro-USD.
BEGIN;

DO $rename$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ai_cost_ledger',     'cost_micro_usd',    'cost_won_micros'),
      ('ai_cost_ledger',     'margin_micro_usd',  'margin_won_micros'),
      ('ai_cost_ledger',     'price_micro_usd',   'price_won_micros'),
      ('ai_generation_jobs', 'price_micro_usd',   'price_micro_won'),
      ('billing_products',   'credits_micro_usd', 'credits_micro_won'),
      ('payment_intents',    'amount_micro_usd',  'amount_micro_won')
    ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=r.tbl AND column_name=r.old_name) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END
$rename$;

COMMIT;
