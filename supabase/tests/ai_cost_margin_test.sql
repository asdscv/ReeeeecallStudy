-- ============================================================================
-- AI cost / margin / pricing regression suite (migration 112).
--
-- Exercises the economic layer that records real provider cost + computes margin
-- on top of the credit wallet: finalize_ai_cost, the pricing config seams
-- (set_ai_pricing_rate / set_ai_pricing_settings / _ai_resolve_rate), and the
-- get_ai_margin_daily monitoring rollup. Complements ai_credit_metering_test.sql
-- (the charging path); this covers cost capture, which never touches charging.
--
-- Same harness as the metering suite: single psql session, auth via
-- request.jwt.claim.role, ON_ERROR_STOP + ASSERT → any failure aborts non-zero.
-- Job rows are inserted directly (isolating cost logic from the metering RPCs).
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO auth.users (id) VALUES
  ('c0000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
\set u 'c0000000-0000-0000-0000-000000000001'

-- Recorded reservations to cost against (id = job_ref). credits drives price.
INSERT INTO public.ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, credits, image_jobs, refunded) VALUES
  ('job_known',   :'u', current_date, 0, 3, 3, 0, false),  -- 3 paid credits, known rate
  ('job_idem',    :'u', current_date, 0, 3, 3, 0, false),
  ('job_est',     :'u', current_date, 0, 2, 2, 0, false),  -- provider omitted usage
  ('job_ratemiss',:'u', current_date, 0, 1, 1, 0, false),  -- known usage, no rate row
  ('job_free',    :'u', current_date, 3, 0, 0, 0, false),  -- free cards → price 0 (CAC)
  ('job_under',   :'u', current_date, 0, 1, 1, 0, false),  -- expensive → under target
  ('job_refunded',:'u', current_date, 0, 3, 3, 0, true),   -- comped success → price 0 in rollup
  ('job_pro',     :'u', current_date, 0, 2, 2, 0, false),  -- new-model rate (extensibility)
  ('job_zero',    :'u', current_date, 0, 2, 2, 0, false);  -- provider reported (0,0) → estimated

-- ════════════════════════════════════════════════════════════════════════════
-- C. finalize_ai_cost — cost/price/margin math + fail-safe branches
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub',  :'u', false);

-- C1: known tokens + seeded rate (gemini-2.5-flash-lite: in 100000, out 400000).
-- won_per_credit=100, usd_won_rate=1350, credits=3.
--   cost_usd = (1000*100000 + 500*400000)/1e6 = 300 micro-USD
--   cost_won = 300*1350 = 405000 micro-₩ ; price = 3*100*1e6 = 300,000,000
--   margin = 299,595,000 ; bps = 299595000*10000/300000000 = 9986
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_known', 'gemini', 'gemini-2.5-flash-lite', 1000, 500);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_known';
  ASSERT r.cost_usd_micros = 300, format('C1 cost_usd %s', r.cost_usd_micros);
  ASSERT r.cost_won_micros = 405000, format('C1 cost_won %s', r.cost_won_micros);
  ASSERT r.price_won_micros = 300000000, format('C1 price %s', r.price_won_micros);
  ASSERT r.margin_won_micros = 299595000, format('C1 margin %s', r.margin_won_micros);
  ASSERT r.margin_bps = 9986, format('C1 bps %s', r.margin_bps);
  ASSERT r.estimated = false AND r.rate_missing = false AND r.under_target = false, format('C1 flags %s/%s/%s', r.estimated, r.rate_missing, r.under_target);
  ASSERT r.tokens_in = 1000 AND r.tokens_out = 500, 'C1 tokens';
END $$;

-- C2: idempotent on job_ref — a re-finalize with different tokens is a no-op
DO $$ DECLARE r ai_cost_ledger; n int; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_known', 'gemini', 'gemini-2.5-flash-lite', 99999, 99999);
  SELECT count(*) INTO n FROM ai_cost_ledger WHERE job_ref = 'job_known';
  ASSERT n = 1, format('C2 expected 1 row, got %s', n);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_known';
  ASSERT r.cost_usd_micros = 300, format('C2 unchanged cost expected 300, got %s', r.cost_usd_micros);
END $$;

-- C3: provider omitted usage → estimated=true, cost NULL, price still set (honest unknown)
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_est', 'gemini', 'gemini-2.5-flash-lite', NULL, NULL);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_est';
  ASSERT r.estimated = true, 'C3 estimated';
  ASSERT r.cost_usd_micros IS NULL AND r.cost_won_micros IS NULL AND r.margin_won_micros IS NULL AND r.margin_bps IS NULL, 'C3 cost/margin NULL';
  ASSERT r.price_won_micros = 200000000, format('C3 price %s (2 credits)', r.price_won_micros);
END $$;

-- C3b: provider reported (0,0) tokens → estimated (no faked 0-cost / 100% margin)
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_zero', 'gemini', 'gemini-2.5-flash-lite', 0, 0);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_zero';
  ASSERT r.estimated = true, 'C3b (0,0) must be estimated, not a real 0-cost row';
  ASSERT r.cost_won_micros IS NULL AND r.margin_bps IS NULL, 'C3b cost/margin NULL';
END $$;

-- C4: known usage but NO rate row → conservative fallback (in 5e6, out 15e6), rate_missing=true
--   cost_usd = (1000*5000000 + 1000*15000000)/1e6 = 20000 ; cost_won = 27,000,000 ; price = 100,000,000
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_ratemiss', 'novendor', 'nomodel', 1000, 1000);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_ratemiss';
  ASSERT r.rate_missing = true AND r.estimated = false, 'C4 rate_missing';
  ASSERT r.cost_usd_micros = 20000, format('C4 cost_usd %s', r.cost_usd_micros);
  ASSERT r.cost_won_micros = 27000000, format('C4 cost_won %s', r.cost_won_micros);
  ASSERT r.margin_won_micros = 73000000, format('C4 margin %s', r.margin_won_micros);
END $$;

-- C5: free/template job (credits=0) → price 0, margin_bps NULL, but cost recorded (CAC)
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_free', 'gemini', 'gemini-2.5-flash-lite', 1000, 500);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_free';
  ASSERT r.price_won_micros = 0, format('C5 price %s', r.price_won_micros);
  ASSERT r.margin_bps IS NULL, 'C5 margin_bps NULL when price 0';
  ASSERT r.cost_won_micros = 405000, format('C5 cost still recorded %s', r.cost_won_micros);
END $$;

-- C6: expensive call vs cheap price → under_target=true (grok rate, 1 credit)
--   cost_usd = (100000*3000000 + 100000*15000000)/1e6 = 1,800,000 ; cost_won = 2.43e9 ; price = 100,000,000
DO $$ DECLARE r ai_cost_ledger; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_under', 'xai', 'grok-3', 100000, 100000);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_under';
  ASSERT r.cost_won_micros = 2430000000, format('C6 cost_won %s', r.cost_won_micros);
  ASSERT r.margin_bps < 8000, format('C6 bps under 80%% target %s', r.margin_bps);
  ASSERT r.under_target = true, 'C6 under_target flag';
  -- net-zero floor breach: a PAID row priced below its real cost
  ASSERT r.price_won_micros > 0 AND r.margin_won_micros < 0, 'C6 net-negative (paid below cost)';
END $$;

-- C7: unknown / foreign job → no-op (no row written, no raise)
DO $$ DECLARE n int; BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_does_not_exist', 'gemini', 'gemini-2.5-flash-lite', 10, 10);
  SELECT count(*) INTO n FROM ai_cost_ledger WHERE job_ref = 'job_does_not_exist';
  ASSERT n = 0, 'C7 unknown job → no row';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. Authorization — finalize is service_role/admin only
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN
    PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_idem', 'gemini', 'gemini-2.5-flash-lite', 10, 10);
    RAISE EXCEPTION 'D1 FAIL: expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  ASSERT NOT has_function_privilege('authenticated','public.finalize_ai_cost(uuid,text,text,text,integer,integer)','EXECUTE'),
    'D1 authenticated must NOT hold EXECUTE on finalize_ai_cost';
  ASSERT has_function_privilege('service_role','public.finalize_ai_cost(uuid,text,text,text,integer,integer)','EXECUTE'),
    'D1 service_role must hold EXECUTE on finalize_ai_cost';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. Pricing config RPCs — admin-only + effect + validation + EXTENSIBILITY
-- ════════════════════════════════════════════════════════════════════════════

-- E1: non-admin authenticated cannot set a rate or settings → 42501
DO $$ BEGIN
  BEGIN PERFORM set_ai_pricing_rate('x','y',1,1,NULL); RAISE EXCEPTION 'E1a expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  BEGIN PERFORM set_ai_pricing_settings(50,NULL,NULL); RAISE EXCEPTION 'E1b expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- E2: service_role sets settings (won_per_credit) → config seam reflects it; invalid rejected
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE v int; BEGIN
  PERFORM set_ai_pricing_settings(p_won_per_credit => 120);
  SELECT _ai_won_per_credit() INTO v;
  ASSERT v = 120, format('E2 won_per_credit %s', v);
  BEGIN PERFORM set_ai_pricing_settings(p_target_margin_bps => 99999); RAISE EXCEPTION 'E2 expected invalid';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- restore for later math determinism
  PERFORM set_ai_pricing_settings(p_won_per_credit => 100);
END $$;

-- E3 (EXTENSIBILITY): add a rate for a NEW model = 1 config row, no code — the next
-- finalize prices it from the new rate (rate_missing=false), NOT the fallback.
DO $$ DECLARE r ai_cost_ledger; rate record; BEGIN
  PERFORM set_ai_pricing_rate('gemini','gemini-2.5-pro', 1250000, 10000000, 'pro tier');
  SELECT * INTO rate FROM _ai_resolve_rate('gemini','gemini-2.5-pro');
  ASSERT rate.in_rate = 1250000 AND rate.out_rate = 10000000, format('E3 resolve %s/%s', rate.in_rate, rate.out_rate);
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_pro', 'gemini', 'gemini-2.5-pro', 1000, 1000);
  SELECT * INTO r FROM ai_cost_ledger WHERE job_ref = 'job_pro';
  ASSERT r.rate_missing = false, 'E3 uses the new rate, not fallback';
  -- cost_usd = (1000*1250000 + 1000*10000000)/1e6 = 11250
  ASSERT r.cost_usd_micros = 11250, format('E3 cost_usd %s', r.cost_usd_micros);
END $$;

-- E4 (effective-dating): re-pricing inserts a new row; the LATEST effective rate wins
DO $$ DECLARE rate record; BEGIN
  PERFORM set_ai_pricing_rate('gemini','gemini-2.5-pro', 9999999, 9999999, 're-price');
  SELECT * INTO rate FROM _ai_resolve_rate('gemini','gemini-2.5-pro');
  ASSERT rate.in_rate = 9999999, format('E4 latest rate wins %s', rate.in_rate);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F. get_ai_margin_daily — admin-only rollup; excludes estimated from margin math;
--    counts unknowns; refunded success = price 0
-- ════════════════════════════════════════════════════════════════════════════

-- F1: non-admin authenticated cannot read business margins → 42501
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM * FROM get_ai_margin_daily(); RAISE EXCEPTION 'F1 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- F2: refunded success is priced 0 in the rollup (comped = real loss)
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ BEGIN
  PERFORM finalize_ai_cost('c0000000-0000-0000-0000-000000000001'::uuid, 'job_refunded', 'gemini', 'gemini-2.5-flash-lite', 1000, 500);
END $$;

-- F3: rollup — gemini-2.5-flash-lite group has job_known(paid, non-est) + job_est(estimated)
--     + job_free(price 0) + job_refunded(refunded). unknown_cost_jobs counts job_est;
--     price sum excludes estimated; refunded contributes 0 price.
DO $$ DECLARE row record; found_grp boolean := false; BEGIN
  FOR row IN SELECT * FROM get_ai_margin_daily() WHERE provider='gemini' AND model='gemini-2.5-flash-lite' LOOP
    found_grp := true;
    -- jobs: job_known, job_est, job_free, job_refunded, job_zero = 5
    ASSERT row.jobs = 5, format('F3 jobs %s', row.jobs);
    -- estimated (unknown cost): job_est + job_zero = 2
    ASSERT row.unknown_cost_jobs = 2, format('F3 unknown %s', row.unknown_cost_jobs);
    -- price sum (non-estimated; refunded priced 0): job_known 300M + job_free 0 + job_refunded 0 = 300M
    ASSERT row.price_won_micros = 300000000, format('F3 price sum %s', row.price_won_micros);
    -- cost sum (non-estimated — refunded cost is REAL and still counts):
    --   job_known 405000 + job_free 405000 + job_refunded 405000 = 1,215,000
    ASSERT row.cost_won_micros = 1215000, format('F3 cost sum %s', row.cost_won_micros);
    -- mig 113 columns: this group is all healthy — no <80% and no PAID-below-cost
    ASSERT row.under_target_jobs = 0, format('F3 under_target %s', row.under_target_jobs);
    ASSERT row.net_negative_jobs = 0, format('F3 net_negative %s', row.net_negative_jobs);
  END LOOP;
  ASSERT found_grp, 'F3 group present';
END $$;

-- F4: the xai/grok-3 group has job_under (1 credit, huge cost) → under_target AND
--     net_negative (PAID below cost) both count it. This is the net-zero floor breach.
DO $$ DECLARE row record; found_grp boolean := false; BEGIN
  FOR row IN SELECT * FROM get_ai_margin_daily() WHERE provider='xai' AND model='grok-3' LOOP
    found_grp := true;
    ASSERT row.under_target_jobs = 1, format('F4 under_target %s', row.under_target_jobs);
    ASSERT row.net_negative_jobs = 1, format('F4 net_negative %s', row.net_negative_jobs);
  END LOOP;
  ASSERT found_grp, 'F4 grok-3 group present';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- G. preview_ai_cost — DRY RUN of the cost math (no ledger write) + net-zero floor
-- ════════════════════════════════════════════════════════════════════════════

-- G1: preview matches finalize math (same as C1 inputs) AND writes NO row
DO $$ DECLARE p record; n_before int; n_after int; BEGIN
  SELECT count(*) INTO n_before FROM ai_cost_ledger;
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 1000, 500, 3);
  ASSERT p.cost_won_micros = 405000 AND p.price_won_micros = 300000000 AND p.margin_bps = 9986,
    format('G1 preview math %s', p);
  ASSERT p.under_target = false AND p.net_negative = false, 'G1 healthy';
  SELECT count(*) INTO n_after FROM ai_cost_ledger;
  ASSERT n_before = n_after, 'G1 dry-run must NOT write a ledger row';
END $$;

-- G2: preview a net-negative PAID scenario (expensive grok, 1 credit) → under_target + net_negative
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM preview_ai_cost('xai','grok-3', 100000, 100000, 1);
  ASSERT p.margin_won_micros < 0, format('G2 margin %s', p.margin_won_micros);
  ASSERT p.under_target = true AND p.net_negative = true, 'G2 net-zero floor breach flagged';
END $$;

-- G3: preview (0,0) → estimated (no faked 0-cost even in dry-run)
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 0, 0, 3);
  ASSERT p.estimated = true AND p.cost_won_micros IS NULL, 'G3 (0,0) estimated';
END $$;

-- G4: preview is admin/service_role only
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM * FROM preview_ai_cost('gemini','gemini-2.5-flash-lite', 10, 10, 1);
    RAISE EXCEPTION 'G4 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

SELECT 'ALL_AI_COST_MARGIN_TESTS_PASSED' AS result;
