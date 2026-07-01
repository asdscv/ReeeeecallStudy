-- ============================================================================
-- AI metered PRICING regression suite (migrations 112→114).
--
-- In the metered model (114) the price a user pays = real provider cost × markup,
-- markup = 10000/(10000 - target_margin_bps) = 5 at 80%. This suite covers the
-- PRICING math: preview_ai_cost (read-only dry-run, no wallet), charge_ai_generation's
-- recorded price/cost/margin in ai_cost_ledger, config-driven markup + rates
-- (extensibility), and the get_ai_margin_daily rollup. The charging FLOW
-- (reserve/charge/release/gate) is in ai_credit_metering_test.sql.
--
-- Single psql session, auth via request.jwt.claim.role/sub. micro-WON bigint.
-- ============================================================================
\set ON_ERROR_STOP on

-- Isolate from any prior suite on the same DB — get_ai_margin_daily aggregates
-- ALL users' cost rows, so a leftover row would pollute the F rollup assertions.
TRUNCATE public.ai_cost_ledger, public.ai_generation_jobs, public.ai_generation_usage,
         public.ai_credit_balance, public.ai_credit_ledger RESTART IDENTITY CASCADE;

INSERT INTO auth.users (id) VALUES ('c0000000-0000-0000-0000-000000000001') ON CONFLICT (id) DO NOTHING;
\set u 'c0000000-0000-0000-0000-000000000001'

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub',  :'u', false);
SELECT add_ai_credits('c0000000-0000-0000-0000-000000000001'::uuid, 1000000000, 'purchase', 'seed');  -- ₩1000 headroom

-- Job rows to charge against (id = job_ref); free/paid/image drive paid_share.
INSERT INTO public.ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs) VALUES
  ('jc_paid', :'u', current_date, 0, 3, 0),   -- fully-paid cards → paid_share 1
  ('jc_mix',  :'u', current_date, 2, 1, 0),   -- mixed → paid_share 1/3
  ('jc_img',  :'u', current_date, 0, 0, 1),   -- image → paid_share 1
  ('jc_zero', :'u', current_date, 0, 2, 0),   -- (0,0) tokens → estimated
  ('jc_new',  :'u', current_date, 0, 1, 0);   -- new-model rate (extensibility)

-- ════════════════════════════════════════════════════════════════════════════
-- P. preview_ai_cost — DRY RUN of the metered price (no wallet write)
-- ════════════════════════════════════════════════════════════════════════════
-- P1: gemini-flash-lite 1000/500 → cost_won 405000; markup 5 → price 2,025,000; margin 80%
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 1000, 500);
  ASSERT p.cost_won_micros = 405000, format('P1 cost %s', p.cost_won_micros);
  ASSERT p.price_won_micros = 2025000, format('P1 price %s', p.price_won_micros);
  ASSERT p.margin_won_micros = 1620000, format('P1 margin %s', p.margin_won_micros);
  ASSERT p.margin_bps = 8000, format('P1 bps %s', p.margin_bps);
  ASSERT p.estimated = false AND p.rate_missing = false, 'P1 flags';
END $$;

-- P2: (0,0) → estimated, price 0
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 0, 0);
  ASSERT p.estimated = true AND p.price_won_micros = 0 AND p.cost_won_micros IS NULL, 'P2 (0,0) estimated';
END $$;

-- P3: unknown model → conservative fallback rate, rate_missing=true, price still computed
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM preview_ai_cost('novendor','nomodel', 1000, 1000);
  ASSERT p.rate_missing = true AND p.price_won_micros > 0, format('P3 %s', p);
END $$;

-- P4: preview is admin/service_role only
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM * FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 10, 10);
    RAISE EXCEPTION 'P4 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CH. charge_ai_generation — recorded price/cost/margin per paid_share
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- CH1: fully-paid card job → paid_share 1 → price = cost×5 = 2,025,000; cost_ledger reflects it
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM charge_ai_generation('c0000000-0000-0000-0000-000000000001'::uuid, 'jc_paid', 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref='jc_paid';
  ASSERT r.cost_won_micros = 405000 AND r.price_won_micros = 2025000, format('CH1 %s/%s', r.cost_won_micros, r.price_won_micros);
  ASSERT r.margin_bps = 8000, format('CH1 bps %s', r.margin_bps);
END $$;

-- CH2: mixed job (paid_share 1/3) → price = round(405000/3*5) = 675000; margin vs FULL cost (free CAC drag)
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM charge_ai_generation('c0000000-0000-0000-0000-000000000001'::uuid, 'jc_mix', 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref='jc_mix';
  ASSERT r.price_won_micros = 675000, format('CH2 price %s', r.price_won_micros);
  ASSERT r.cost_won_micros = 405000, format('CH2 full cost %s', r.cost_won_micros);  -- full call cost recorded
  -- margin = price - FULL cost = 675000 - 405000 = 270000 (blended, free cards drag it below 80%)
  ASSERT r.margin_won_micros = 270000, format('CH2 blended margin %s', r.margin_won_micros);
END $$;

-- CH3: image job → paid_share 1 → price = cost×5
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM charge_ai_generation('c0000000-0000-0000-0000-000000000001'::uuid, 'jc_img', 'gemini','gemini-2.5-flash', 1000, 800);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref='jc_img';
  -- cost_usd=(1000*300000+800*2500000)/1e6=2300; cost_won=round(2300*1350)=3105000; price=×5=15525000
  ASSERT r.cost_won_micros = 3105000 AND r.price_won_micros = 15525000, format('CH3 %s/%s', r.cost_won_micros, r.price_won_micros);
  ASSERT r.margin_bps = 8000, format('CH3 bps %s', r.margin_bps);
END $$;

-- CH4: (0,0) tokens → estimated, price 0 (charge absorbs the unpriceable success)
DO $$ DECLARE r ai_cost_ledger; ch boolean; BEGIN
  PERFORM charge_ai_generation('c0000000-0000-0000-0000-000000000001'::uuid, 'jc_zero', 'gemini','gemini-2.5-flash-lite', 0, 0);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref='jc_zero';
  ASSERT r.estimated = true AND r.price_won_micros = 0, 'CH4 (0,0) estimated, price 0';
  SELECT charged INTO ch FROM ai_generation_jobs WHERE id='jc_zero';
  ASSERT ch = true, 'CH4 still marked charged';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. config-driven markup + rate (EXTENSIBILITY, no code)
-- ════════════════════════════════════════════════════════════════════════════

-- E1: change target margin 80%→90% → markup 10 → preview price doubles vs P1
DO $$ DECLARE p record; BEGIN
  PERFORM set_ai_pricing_settings(p_target_margin_bps => 9000);
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 1000, 500);
  ASSERT p.price_won_micros = 4050000, format('E1 markup10 price %s', p.price_won_micros);  -- 405000*10
  ASSERT p.margin_bps = 9000, format('E1 bps %s', p.margin_bps);
  PERFORM set_ai_pricing_settings(p_target_margin_bps => 8000);  -- restore
END $$;

-- E2: add a rate for a NEW model = 1 row → charge prices it (rate_missing=false)
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM set_ai_pricing_rate('gemini','gemini-2.5-pro', 1250000, 10000000, 'pro');
  PERFORM charge_ai_generation('c0000000-0000-0000-0000-000000000001'::uuid, 'jc_new', 'gemini','gemini-2.5-pro', 1000, 1000);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref='jc_new';
  ASSERT r.rate_missing = false, 'E2 uses new rate';
  -- cost_usd=(1000*1250000+1000*10000000)/1e6=11250; cost_won=round(11250*1350)=15187500; price=×5=75937500
  ASSERT r.cost_won_micros = 15187500 AND r.price_won_micros = 75937500, format('E2 %s/%s', r.cost_won_micros, r.price_won_micros);
END $$;

-- E3: 100% margin (10000 bps) is rejected — it would make markup divide by zero
DO $$ BEGIN
  BEGIN PERFORM set_ai_pricing_settings(p_target_margin_bps => 10000);
    RAISE EXCEPTION 'E3 expected invalid (100%% margin)';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F. get_ai_margin_daily rollup — admin-only; charged rows reflected
-- ════════════════════════════════════════════════════════════════════════════
-- F1: non-admin authenticated blocked
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM * FROM get_ai_margin_daily(); RAISE EXCEPTION 'F1 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- F2: gemini-2.5-flash-lite group = jc_paid (fully paid, 80%) + jc_mix + jc_zero(estimated)
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE row record; found boolean := false; BEGIN
  FOR row IN SELECT * FROM get_ai_margin_daily() WHERE provider='gemini' AND model='gemini-2.5-flash-lite' LOOP
    found := true;
    ASSERT row.jobs = 3, format('F2 jobs %s', row.jobs);                    -- jc_paid, jc_mix, jc_zero
    ASSERT row.unknown_cost_jobs = 1, format('F2 estimated %s', row.unknown_cost_jobs);  -- jc_zero
    -- price sum (non-estimated): jc_paid 2,025,000 + jc_mix 675,000 = 2,700,000
    ASSERT row.price_won_micros = 2700000, format('F2 price %s', row.price_won_micros);
  END LOOP;
  ASSERT found, 'F2 group present';
END $$;

SELECT 'ALL_AI_COST_MARGIN_TESTS_PASSED' AS result;
