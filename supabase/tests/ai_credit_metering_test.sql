-- ============================================================================
-- AI metered-billing charging-flow regression suite (migration 114).
--
-- The charging model is METERED micro-WON: a pre-gen GATE (reserve_ai_generation
-- / reserve_ai_image — free/paid split, reject 402 if paid work & empty wallet,
-- NO money moved) + a post-gen CHARGE (charge_ai_generation — price = real token
-- cost × markup on the paid share, deducted from the wallet, may dip negative) +
-- a failure RELEASE (release_ai_job — reverse counters, no wallet touch). Wallet
-- top-ups via add_ai_credits (micro-WON). Pricing math itself is in
-- ai_cost_margin_test.sql; this covers the charging FLOW.
--
-- Same harness: single psql session, auth via request.jwt.claim.role/sub,
-- ON_ERROR_STOP + ASSERT. 1 micro-WON = 1e-6 KRW; ₩10 = 10,000,000 micro-WON.
-- ============================================================================
\set ON_ERROR_STOP on

-- Isolate from any prior suite on the same DB (CI runs metering + cost sequentially).
TRUNCATE public.ai_cost_ledger, public.ai_generation_jobs, public.ai_generation_usage,
         public.ai_credit_balance, public.ai_credit_ledger RESTART IDENTITY CASCADE;

INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-0000-0000-000000000001'),   -- free→paid lifecycle + charge
  ('a2000000-0000-0000-0000-000000000002'),   -- gate rejection (empty wallet)
  ('a3000000-0000-0000-0000-000000000003')    -- release + slight-negative
ON CONFLICT (id) DO NOTHING;
\set u1 'a1000000-0000-0000-0000-000000000001'
\set u2 'a2000000-0000-0000-0000-000000000002'
\set u3 'a3000000-0000-0000-0000-000000000003'

-- ════════════════════════════════════════════════════════════════════════════
-- A. add_ai_credits — grants micro-WON, service_role-only, idempotent
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE b bigint; n int; BEGIN
  b := add_ai_credits('a1000000-0000-0000-0000-000000000001'::uuid, 10000000, 'purchase', 'pay_u1');  -- ₩10
  ASSERT b = 10000000, format('A1 balance %s', b);
  -- idempotent on ref
  b := add_ai_credits('a1000000-0000-0000-0000-000000000001'::uuid, 10000000, 'purchase', 'pay_u1');
  ASSERT b = 10000000, format('A2 dup-ref balance %s', b);
  SELECT count(*) INTO n FROM ai_credit_ledger WHERE ref='pay_u1' AND delta>0;
  ASSERT n = 1, format('A2 one grant row, got %s', n);
END $$;
-- non-service authenticated cannot grant
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ BEGIN
  BEGIN PERFORM add_ai_credits('a1000000-0000-0000-0000-000000000001'::uuid, 5, 'hack', NULL);
    RAISE EXCEPTION 'A3 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. reserve — free/paid split, wallet gate, NO money moved (u1, u2)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', :'u1', false);   -- role authenticated

-- B1: free cards (under 10) → free split, no gate, wallet untouched, job charged=false
DO $$ DECLARE j jsonb; used int; paid int; bal bigint; jr text; ch boolean; BEGIN
  j := reserve_ai_generation('cards', 6);
  ASSERT (j->>'free_now')::int=6 AND (j->>'paid_now')::int=0 AND (j->>'remaining_free')::int=4, format('B1 %s', j::text);
  SELECT free_cards_used, paid_cards_used INTO used, paid FROM ai_generation_usage WHERE user_id=auth.uid();
  ASSERT used=6 AND paid=0, format('B1 counters %s/%s', used, paid);
  SELECT balance INTO bal FROM ai_credit_balance WHERE user_id=auth.uid();
  ASSERT bal=10000000, format('B1 wallet untouched %s', bal);
  jr := j->>'job_ref';
  SELECT charged INTO ch FROM ai_generation_jobs WHERE id=jr;
  ASSERT ch=false, 'B1 job not charged yet';
END $$;

-- B2: crossing into paid with a funded wallet → free 4 + paid 2, gate passes, still no deduct
DO $$ DECLARE j jsonb; used int; paid int; bal bigint; BEGIN
  j := reserve_ai_generation('cards', 6);
  ASSERT (j->>'free_now')::int=4 AND (j->>'paid_now')::int=2, format('B2 split %s', j::text);
  SELECT free_cards_used, paid_cards_used INTO used, paid FROM ai_generation_usage WHERE user_id=auth.uid();
  ASSERT used=10 AND paid=2, format('B2 counters %s/%s', used, paid);
  SELECT balance INTO bal FROM ai_credit_balance WHERE user_id=auth.uid();
  ASSERT bal=10000000, format('B2 wallet still untouched pre-charge %s', bal);
END $$;

-- B3: template/deck never gated (paid=0), even with an empty wallet (u2)
SELECT set_config('request.jwt.claim.sub', :'u2', false);
DO $$ DECLARE j jsonb; BEGIN
  PERFORM reserve_ai_generation('cards', 10);                 -- exhaust free
  j := reserve_ai_generation('template', 0);                  -- paid=0 → no gate
  ASSERT (j->>'paid_now')::int=0, format('B3 template paid %s', j->>'paid_now');
END $$;

-- B4: paid card with an EMPTY wallet → 402 (P0002), before any provider work
DO $$ BEGIN
  BEGIN PERFORM reserve_ai_generation('cards', 1);            -- free exhausted → paid=1, wallet empty
    RAISE EXCEPTION 'B4 expected insufficient-wallet raise';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. charge — deduct price from wallet, idempotent, free→0 (u1)
-- ════════════════════════════════════════════════════════════════════════════
-- Grab u1's two reserved jobs: the paid one (paid_cards=2) and the free one.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$
DECLARE j_paid text; j_free text; b0 bigint; b1 bigint; pr bigint; ch boolean; n int;
BEGIN
  SELECT id INTO j_paid FROM ai_generation_jobs WHERE user_id='a1000000-0000-0000-0000-000000000001' AND paid_cards=2 LIMIT 1;
  SELECT id INTO j_free FROM ai_generation_jobs WHERE user_id='a1000000-0000-0000-0000-000000000001' AND paid_cards=0 AND free_cards=6 LIMIT 1;
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id='a1000000-0000-0000-0000-000000000001';

  -- C1: charge the PAID job (free_cards=4,paid_cards=2 → paid_share=1/3). gemini-flash-lite
  --     1000/500 tok → cost=300 micro-USD (usd_won_rate=1, mig 145); price =
  --     round(300 * 1/3 * 5) = 500 micro-USD; deduct.
  PERFORM charge_ai_generation('a1000000-0000-0000-0000-000000000001'::uuid, j_paid, 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id='a1000000-0000-0000-0000-000000000001';
  SELECT price_micro_won, charged INTO pr, ch FROM ai_generation_jobs WHERE id=j_paid;
  ASSERT pr = 500, format('C1 price %s', pr);
  ASSERT b1 = b0 - 500, format('C1 balance %s (from %s)', b1, b0);
  ASSERT ch = true, 'C1 charged';
  SELECT count(*) INTO n FROM ai_credit_ledger WHERE ref=j_paid AND reason='spend' AND delta=-500;
  ASSERT n = 1, format('C1 spend ledger row %s', n);

  -- C2: idempotent — re-charge the same job is a no-op (balance unchanged)
  PERFORM charge_ai_generation('a1000000-0000-0000-0000-000000000001'::uuid, j_paid, 'gemini','gemini-2.5-flash-lite', 9999, 9999);
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id='a1000000-0000-0000-0000-000000000001';
  ASSERT b1 = b0 - 500, format('C2 idempotent balance %s', b1);

  -- C3: charge a FREE-only job (paid_share=0) → price 0, wallet unchanged
  PERFORM charge_ai_generation('a1000000-0000-0000-0000-000000000001'::uuid, j_free, 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT price_micro_won INTO pr FROM ai_generation_jobs WHERE id=j_free;
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id='a1000000-0000-0000-0000-000000000001';
  ASSERT pr = 0 AND b1 = b0 - 500, format('C3 free price %s balance %s', pr, b1);
END $$;

-- C4: charge is service_role/admin only
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ DECLARE jr text; BEGIN
  SELECT id INTO jr FROM ai_generation_jobs WHERE user_id='a1000000-0000-0000-0000-000000000001' LIMIT 1;
  BEGIN PERFORM charge_ai_generation('a1000000-0000-0000-0000-000000000001'::uuid, jr, 'gemini','gemini-2.5-flash-lite', 10, 10);
    RAISE EXCEPTION 'C4 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  ASSERT NOT has_function_privilege('authenticated','public.charge_ai_generation(uuid,text,text,text,integer,integer)','EXECUTE'), 'C4 authenticated no EXECUTE';
  ASSERT has_function_privilege('service_role','public.charge_ai_generation(uuid,text,text,text,integer,integer)','EXECUTE'), 'C4 service_role EXECUTE';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. release — failure reverses counters, no wallet touch, idempotent (u3)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits('a3000000-0000-0000-0000-000000000003'::uuid, 1, 'purchase', 'pay_u3');  -- ₩0.000001 (tiny)
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', :'u3', false);
DO $$ DECLARE j jsonb; jr text; BEGIN
  PERFORM reserve_ai_generation('cards', 10);                 -- exhaust free
  j := reserve_ai_generation('cards', 3);                     -- paid=3; wallet=1>0 → gate passes
  ASSERT (j->>'paid_now')::int=3, format('D0 paid %s', j->>'paid_now');
END $$;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE jr text; paid int; bal bigint; ref boolean; BEGIN
  SELECT id INTO jr FROM ai_generation_jobs WHERE user_id='a3000000-0000-0000-0000-000000000003' AND paid_cards=3 ORDER BY created_at DESC LIMIT 1;
  SELECT balance INTO bal FROM ai_credit_balance WHERE user_id='a3000000-0000-0000-0000-000000000003';
  PERFORM release_ai_job('a3000000-0000-0000-0000-000000000003'::uuid, jr);
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id='a3000000-0000-0000-0000-000000000003';
  ASSERT paid = 0, format('D1 paid reversed %s', paid);       -- 3 → 0
  ASSERT (SELECT balance FROM ai_credit_balance WHERE user_id='a3000000-0000-0000-0000-000000000003') = bal, 'D1 wallet untouched by release';
  ASSERT (SELECT refunded FROM ai_generation_jobs WHERE id=jr), 'D1 job marked refunded';
  PERFORM release_ai_job('a3000000-0000-0000-0000-000000000003'::uuid, jr);  -- idempotent
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id='a3000000-0000-0000-0000-000000000003';
  ASSERT paid = 0, format('D2 idempotent %s', paid);
END $$;

-- D3: SLIGHT NEGATIVE allowed — a ₩0.000001 wallet can still generate (gate passes on >0),
--     and the post-gen charge dips the balance below zero (bounded to one batch).
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ DECLARE j jsonb; BEGIN j := reserve_ai_generation('cards', 3); END $$;  -- free exhausted → paid 3, gate passes on bal=1
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE jr text; bal bigint; BEGIN
  SELECT id INTO jr FROM ai_generation_jobs WHERE user_id='a3000000-0000-0000-0000-000000000003' AND paid_cards=3 AND NOT charged AND NOT refunded ORDER BY created_at DESC LIMIT 1;
  PERFORM charge_ai_generation('a3000000-0000-0000-0000-000000000003'::uuid, jr, 'gemini','gemini-2.5-flash-lite', 1000, 500);
  SELECT balance INTO bal FROM ai_credit_balance WHERE user_id='a3000000-0000-0000-0000-000000000003';
  ASSERT bal < 0, format('D3 slight-negative allowed, balance %s', bal);   -- 1 - 2,025,000 = -2,024,999
END $$;

-- D4: release is service_role/admin only + does NOT release a CHARGED (succeeded) job
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ DECLARE jr text; BEGIN
  SELECT id INTO jr FROM ai_generation_jobs WHERE user_id='a3000000-0000-0000-0000-000000000003' LIMIT 1;
  BEGIN PERFORM release_ai_job('a3000000-0000-0000-0000-000000000003'::uuid, jr);
    RAISE EXCEPTION 'D4 expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE jr text; paid_before int; paid_after int; BEGIN
  -- the D3 charged job: release must be a no-op (charged guard)
  SELECT id INTO jr FROM ai_generation_jobs WHERE user_id='a3000000-0000-0000-0000-000000000003' AND charged LIMIT 1;
  SELECT paid_cards_used INTO paid_before FROM ai_generation_usage WHERE user_id='a3000000-0000-0000-0000-000000000003';
  PERFORM release_ai_job('a3000000-0000-0000-0000-000000000003'::uuid, jr);
  SELECT paid_cards_used INTO paid_after FROM ai_generation_usage WHERE user_id='a3000000-0000-0000-0000-000000000003';
  ASSERT paid_before = paid_after, 'D4 charged job not released';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. reserve authz — authenticated-callable, not anon
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  ASSERT has_function_privilege('authenticated','public.reserve_ai_generation(text,integer)','EXECUTE'), 'E authenticated can reserve';
  ASSERT NOT has_function_privilege('anon','public.reserve_ai_generation(text,integer)','EXECUTE'), 'E anon cannot reserve';
END $$;

SELECT 'ALL_AI_METERING_TESTS_PASSED' AS result;
