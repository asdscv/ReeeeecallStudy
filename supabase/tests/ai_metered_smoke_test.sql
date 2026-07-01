-- ============================================================================
-- AI metered billing — SMOKE + NET-ZERO + DRY-RUN + reconcile/est-price suite.
--
-- A fast, high-signal companion to the detailed metering/pricing suites:
--   SMOKE     — the full happy flow works end-to-end (reserve free → reserve paid
--               → charge → wallet debited).
--   NET-ZERO  — every FAILURE path moves NO money (release reverses counters,
--               leaves the wallet + ledgers untouched); a FREE gen charges 0.
--   DRY-RUN   — preview_ai_cost previews the metered price and writes NOTHING.
--   EST-PRICE — refresh_ai_est_price calibrates the UI quote from real charges (mig 115).
--
-- Single psql session, auth via request.jwt.claim.role/sub. micro-WON bigint.
-- ============================================================================
\set ON_ERROR_STOP on

TRUNCATE public.ai_cost_ledger, public.ai_generation_jobs, public.ai_generation_usage,
         public.ai_credit_balance, public.ai_credit_ledger RESTART IDENTITY CASCADE;
UPDATE public.ai_pricing_settings SET target_margin_bps = 8000, est_price_per_card_micro = 2000000 WHERE id = 1;

INSERT INTO auth.users (id) VALUES
  ('50000000-0000-0000-0000-000000000001'),   -- smoke
  ('50000000-0000-0000-0000-000000000002'),   -- net-zero
  ('50000000-0000-0000-0000-000000000003')    -- reconcile
ON CONFLICT (id) DO NOTHING;
\set s1 '50000000-0000-0000-0000-000000000001'
\set s2 '50000000-0000-0000-0000-000000000002'
\set s3 '50000000-0000-0000-0000-000000000003'

-- ════════════════════════════ SMOKE ════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits(:'s1'::uuid, 100000000, 'purchase', 'smoke');   -- ₩100
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'s1', false);
DO $$ DECLARE j jsonb; jr text; b0 bigint; b1 bigint; BEGIN
  PERFORM reserve_ai_generation('cards', 6);              -- 6 free
  j := reserve_ai_generation('cards', 6);                 -- 4 free + 2 paid (gate passes)
  jr := j->>'job_ref';
  ASSERT (j->>'paid_now')::int = 2, format('SMOKE reserve paid %s', j->>'paid_now');
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id=auth.uid();
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM charge_ai_generation(auth.uid(), jr, 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id=auth.uid();
  ASSERT b1 < b0, format('SMOKE wallet debited %s → %s', b0, b1);
  ASSERT b1 = b0 - 675000, format('SMOKE charged 675000 (paid_share 1/3), got %s', b0 - b1);  -- price for jr
END $$;

-- ════════════════════════════ NET-ZERO ════════════════════════════
-- A failed (released) paid gen must move NO money and reverse counters.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits(:'s2'::uuid, 100000000, 'purchase', 'nz');
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'s2', false);
DO $$ DECLARE j jsonb; jr text; b0 bigint; b1 bigint; paid int; nspend int; ncost int; BEGIN
  PERFORM reserve_ai_generation('cards', 10);             -- exhaust free
  j := reserve_ai_generation('cards', 3);                 -- 3 paid, gate passes (wallet 100M)
  jr := j->>'job_ref';
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id=auth.uid();
  -- simulate provider failure → release
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM release_ai_job(auth.uid(), jr);
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id=auth.uid();
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id=auth.uid();
  SELECT count(*) INTO nspend FROM ai_credit_ledger WHERE user_id=auth.uid() AND reason='spend';
  SELECT count(*) INTO ncost  FROM ai_cost_ledger    WHERE user_id=auth.uid();
  ASSERT b1 = b0, format('NET-ZERO wallet untouched (%s = %s)', b1, b0);
  ASSERT paid = 0, format('NET-ZERO paid counter reversed, got %s', paid);
  ASSERT nspend = 0, format('NET-ZERO no spend ledger row, got %s', nspend);
  ASSERT ncost = 0, format('NET-ZERO no cost row, got %s', ncost);
END $$;

-- ════════════════════════════ DRY-RUN ════════════════════════════
-- preview_ai_cost previews the metered price and writes NOTHING.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE p record; n0 int; n1 int; BEGIN
  SELECT count(*) INTO n0 FROM ai_cost_ledger;
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 1000, 500);
  ASSERT p.cost_won_micros = 405000 AND p.price_won_micros = 2025000 AND p.margin_bps = 8000,
    format('DRY-RUN flash-lite %s', p);
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash', 1000, 800);
  -- cost_usd=(1000*300000+800*2500000)/1e6=2300; cost_won=3105000; price=×5=15525000
  ASSERT p.price_won_micros = 15525000, format('DRY-RUN flash %s', p.price_won_micros);
  SELECT count(*) INTO n1 FROM ai_cost_ledger;
  ASSERT n0 = n1, 'DRY-RUN wrote nothing';
END $$;

-- ════════════════════════════ EST-PRICE (mig 115) ════════════════════════════
-- refresh_ai_est_price calibrates from the real (non-estimated) per-paid-card price.
-- Only real charged row is the SMOKE charge: price 675000 / 2 paid = 337500.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE v bigint; setv bigint; BEGIN
  v := refresh_ai_est_price();
  ASSERT v = 337500, format('EST-PRICE refreshed to avg per-paid-card, got %s', v);
  SELECT est_price_per_card_micro INTO setv FROM ai_pricing_settings WHERE id=1;
  ASSERT setv = 337500, format('EST-PRICE setting updated, got %s', setv);
END $$;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM refresh_ai_est_price(); RAISE EXCEPTION 'EST-PRICE expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

SELECT 'ALL_AI_METERED_SMOKE_TESTS_PASSED' AS result;
