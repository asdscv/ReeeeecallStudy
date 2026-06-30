-- ============================================================================
-- AI credit / metering money-logic regression suite.
--
-- Exercises the FINAL cumulative schema (migrations 108→111 applied in order)
-- for the server-side AI generation wallet:
--   * record_ai_generation  — free-tier accounting + atomic paid debit
--   * record_ai_image        — image jobs (always paid)
--   * add_ai_credits         — privileged, idempotent credit grant
--   * refund_ai_job          — privileged, idempotent, amount-derived refund
--   * get_ai_wallet / get_ai_generation_quota — read snapshots
--
-- These are the functions that move money, so they get assertion coverage that
-- runs on every PR. The suite mirrors the throwaway-docker harness used during
-- development, retargeted onto the CI bootstrap auth shim (auth.uid()/auth.role()
-- read request.jwt.claim.*; is_admin() reads profiles → false here, so the
-- service_role path is what authorizes the privileged RPCs).
--
-- Run as a single psql session so set_config(..., is_local=false) persists
-- across statements. ON_ERROR_STOP + ASSERT means any failure aborts non-zero.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Test subjects (FK → auth.users) ─────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),  -- u1: free → paid lifecycle
  ('22222222-2222-2222-2222-222222222222'),  -- u2: single-call free+paid split
  ('33333333-3333-3333-3333-333333333333'),  -- u3: image metering
  ('44444444-4444-4444-4444-444444444444'),  -- u4: jobs + refund_ai_job
  ('55555555-5555-5555-5555-555555555555')   -- u5: per-user isolation
ON CONFLICT (id) DO NOTHING;

-- Helper: act as a given user with a given JWT role. is_admin() stays false
-- (no admin profile rows), so authorization comes purely from auth.role().
\set u1 '11111111-1111-1111-1111-111111111111'
\set u2 '22222222-2222-2222-2222-222222222222'
\set u3 '33333333-3333-3333-3333-333333333333'
\set u4 '44444444-4444-4444-4444-444444444444'
\set u5 '55555555-5555-5555-5555-555555555555'

-- ════════════════════════════════════════════════════════════════════════════
-- A. Free tier — 10 free cards/day, atomic over-limit rejection (u1)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'u1', false);

-- A1: free cards accumulate; remaining_free counts down to 0
DO $$ DECLARE j jsonb; used int; paid int; BEGIN
  j := record_ai_generation('cards', 6);
  ASSERT (j->>'remaining_free')::int = 4, format('A1a remaining %s', j->>'remaining_free');
  ASSERT (j->>'free_now')::int = 6 AND (j->>'paid_now')::int = 0, format('A1a split %s', j::text);
  j := record_ai_generation('cards', 4);
  ASSERT (j->>'remaining_free')::int = 0, format('A1b remaining %s', j->>'remaining_free');
  SELECT free_cards_used, paid_cards_used INTO used, paid
    FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT used = 10 AND paid = 0, format('A1 used=%s paid=%s', used, paid);
END $$;

-- A2: 11th free card with no credits → P0002, fully rolled back (no usage bump,
--     no ledger row)
DO $$ DECLARE used int; paid int; BEGIN
  BEGIN
    PERFORM record_ai_generation('cards', 1);
    RAISE EXCEPTION 'A2 FAIL: expected insufficient-credits raise';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;
  SELECT free_cards_used, paid_cards_used INTO used, paid
    FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT used = 10 AND paid = 0, format('A2 rollback used=%s paid=%s', used, paid);
  ASSERT NOT EXISTS (SELECT 1 FROM ai_credit_ledger WHERE user_id = auth.uid()),
    'A2 no ledger row on rejected card';
END $$;

-- A3: template/deck never consume the card quota (p_cards forced to 0)
DO $$ DECLARE used int; BEGIN
  PERFORM record_ai_generation('template', 0);
  PERFORM record_ai_generation('deck', 99);
  SELECT free_cards_used INTO used FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT used = 10, format('A3 card usage must stay 10, got %s', used);
END $$;

-- A4: read-only quota snapshot
DO $$ DECLARE fl int; fu int; rem int; BEGIN
  SELECT free_limit, free_used, remaining INTO fl, fu, rem FROM get_ai_generation_quota();
  ASSERT fl = 10 AND fu = 10 AND rem = 0, format('A4 limit=%s used=%s rem=%s', fl, fu, rem);
END $$;

-- A5: invalid kind is rejected
DO $$ BEGIN
  BEGIN
    PERFORM record_ai_generation('bogus', 1);
    RAISE EXCEPTION 'A5 FAIL: expected invalid-kind rejection';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. add_ai_credits — authorization + idempotency (u1)
-- ════════════════════════════════════════════════════════════════════════════

-- B1: a plain authenticated (non-admin) user CANNOT grant credits → 42501
DO $$ BEGIN
  BEGIN
    PERFORM add_ai_credits(auth.uid(), 10, 'hack');
    RAISE EXCEPTION 'B1 FAIL: expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

-- B2: service_role grants 5 (ref pay_1) → balance 5
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ DECLARE b int; BEGIN
  b := add_ai_credits(auth.uid(), 5, 'purchase', 'pay_1');
  ASSERT b = 5, format('B2 balance %s', b);
END $$;

-- B3: replaying the SAME payment ref is a no-op (one ledger row, balance unchanged)
DO $$ DECLARE b int; n int; BEGIN
  b := add_ai_credits(auth.uid(), 5, 'purchase', 'pay_1');
  ASSERT b = 5, format('B3 dup-ref balance %s (expected 5)', b);
  SELECT count(*) INTO n FROM ai_credit_ledger WHERE ref = 'pay_1' AND delta > 0;
  ASSERT n = 1, format('B3 expected 1 grant ledger row for pay_1, got %s', n);
END $$;

-- B4: invalid grant (non-positive credits) → invalid_parameter_value
DO $$ BEGIN
  BEGIN
    PERFORM add_ai_credits(auth.uid(), 0, 'purchase', 'pay_zero');
    RAISE EXCEPTION 'B4 FAIL: expected invalid-grant rejection';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Paid overage — atomic credit debit + rollback (u1, now 10 free used + 5 credits)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);

-- C1: 3 cards, all paid (free exhausted) → spend 3, balance 2, paid 3
DO $$ DECLARE j jsonb; b int; paid int; BEGIN
  j := record_ai_generation('cards', 3);
  ASSERT (j->>'free_now')::int = 0 AND (j->>'paid_now')::int = 3
     AND (j->>'credits_spent')::int = 3, format('C1 split %s', j::text);
  ASSERT (j->>'job_ref') IS NOT NULL, 'C1 job_ref present';
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT b = 2 AND paid = 3, format('C1 b=%s paid=%s', b, paid);
END $$;

-- C2: 3 cards but only 2 credits → P0002, fully rolled back
DO $$ DECLARE b int; paid int; BEGIN
  BEGIN
    PERFORM record_ai_generation('cards', 3);
    RAISE EXCEPTION 'C2 FAIL: expected insufficient raise';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT b = 2 AND paid = 3, format('C2 rollback b=%s paid=%s', b, paid);
END $$;

-- C3: 2 cards exactly drains the wallet → balance 0, paid 5
DO $$ DECLARE b int; paid int; BEGIN
  PERFORM record_ai_generation('cards', 2);
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT b = 0 AND paid = 5, format('C3 b=%s paid=%s', b, paid);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. Single-call free+paid split + wallet snapshot (u2, 5 credits)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits(:'u2'::uuid, 5, 'purchase', 'pay_2');
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'u2', false);

-- D1: request 12 with 5 credits → 10 free + 2 paid (2 credits), balance 3
DO $$ DECLARE j jsonb; b int; used int; paid int; BEGIN
  j := record_ai_generation('cards', 12);
  ASSERT (j->>'remaining_free')::int = 0 AND (j->>'free_now')::int = 10
     AND (j->>'paid_now')::int = 2 AND (j->>'credits_spent')::int = 2,
     format('D1 split %s', j::text);
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  SELECT free_cards_used, paid_cards_used INTO used, paid
    FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT b = 3 AND used = 10 AND paid = 2, format('D1 b=%s used=%s paid=%s', b, used, paid);
END $$;

-- D2: wallet snapshot exposes balance + both unit prices
DO $$ DECLARE bal int; cpc int; cpi int; BEGIN
  SELECT balance, credits_per_card, credits_per_image INTO bal, cpc, cpi FROM get_ai_wallet();
  ASSERT bal = 3 AND cpc = 1 AND cpi = 5, format('D2 bal=%s cpc=%s cpi=%s', bal, cpc, cpi);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. Image metering — always paid, atomic (u3, 12 credits)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits(:'u3'::uuid, 12, 'purchase', 'pay_3');
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'u3', false);

-- E1: one image job debits 5, image_jobs=1, ledger spend_image -5, job_ref present
DO $$ DECLARE j jsonb; jobs int; b int; BEGIN
  j := record_ai_image();
  ASSERT (j->>'credits_spent')::int = 5 AND (j->>'balance')::int = 7, format('E1 %s', j::text);
  ASSERT (j->>'job_ref') IS NOT NULL, 'E1 job_ref present';
  SELECT image_jobs INTO jobs FROM ai_generation_usage WHERE user_id = auth.uid();
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  ASSERT jobs = 1 AND b = 7, format('E1 jobs=%s b=%s', jobs, b);
  ASSERT EXISTS (SELECT 1 FROM ai_credit_ledger
    WHERE user_id = auth.uid() AND reason = 'spend_image' AND delta = -5), 'E1 ledger';
END $$;

-- E2: deplete (12/5 = 2 jobs), 3rd is insufficient → P0002, rolled back
DO $$ DECLARE b int; jobs int; BEGIN
  PERFORM record_ai_image();  -- balance 7 → 2
  BEGIN
    PERFORM record_ai_image();  -- needs 5, only 2 left
    RAISE EXCEPTION 'E2 FAIL: expected insufficient raise';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = auth.uid();
  SELECT image_jobs INTO jobs FROM ai_generation_usage WHERE user_id = auth.uid();
  ASSERT b = 2 AND jobs = 2, format('E2 b=%s jobs=%s (expected 2,2)', b, jobs);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F. Jobs + refund_ai_job — derived amount, idempotent, service_role-only (u4)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits(:'u4'::uuid, 10, 'purchase', 'pay_4');
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'u4', false);

-- F1: exhaust free, then a paid batch writes a job row carrying the exact reservation
DO $$ DECLARE j jsonb; ref text; n int; BEGIN
  FOR i IN 1..10 LOOP PERFORM record_ai_generation('cards', 1); END LOOP;  -- 10 free
  j := record_ai_generation('cards', 3);  -- 3 paid → 3 credits
  ref := j->>'job_ref';
  SELECT count(*) INTO n FROM ai_generation_jobs
    WHERE id = ref AND user_id = auth.uid()
      AND free_cards = 0 AND paid_cards = 3 AND credits = 3 AND image_jobs = 0 AND NOT refunded;
  ASSERT n = 1, format('F1 job row mismatch (%s)', n);
END $$;

-- F2: refund_ai_job (service_role) reverses EXACTLY from the row + is idempotent
SELECT set_config('request.jwt.claim.role', 'service_role', false);
-- v_ref (not `ref`) to avoid colliding with the ai_credit_ledger.ref column name
-- inside the EXISTS below — plpgsql would otherwise read both sides as the variable.
DO $$ DECLARE v_uid uuid := auth.uid(); v_ref text; b int; paid int; BEGIN
  SELECT id INTO v_ref FROM ai_generation_jobs
    WHERE user_id = v_uid AND credits = 3 ORDER BY created_at DESC LIMIT 1;
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT b = 7, format('F2 pre-refund balance %s', b);

  PERFORM refund_ai_job(v_uid, v_ref);
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT paid_cards_used INTO paid FROM ai_generation_usage WHERE user_id = v_uid;
  ASSERT b = 10 AND paid = 0, format('F2 after refund b=%s paid=%s', b, paid);
  ASSERT (SELECT refunded FROM ai_generation_jobs WHERE id = v_ref), 'F2 job marked refunded';
  ASSERT EXISTS (SELECT 1 FROM ai_credit_ledger
    WHERE ai_credit_ledger.ref = v_ref AND reason = 'refund' AND delta = 3), 'F2 refund ledger row';

  PERFORM refund_ai_job(v_uid, v_ref);  -- replay
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT b = 10, format('F2 idempotent — replay must not double-credit, b=%s', b);
END $$;

-- F3: refund is service_role/admin only — authenticated is blocked AND lacks EXECUTE
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$ DECLARE v_uid uuid := auth.uid(); ref text; BEGIN
  SELECT id INTO ref FROM ai_generation_jobs WHERE user_id = v_uid LIMIT 1;
  BEGIN
    PERFORM refund_ai_job(v_uid, ref);
    RAISE EXCEPTION 'F3 FAIL: expected not-authorized';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  ASSERT NOT has_function_privilege('authenticated', 'public.refund_ai_job(uuid,text)', 'EXECUTE'),
    'F3 authenticated must NOT hold EXECUTE on refund_ai_job';
  ASSERT has_function_privilege('service_role', 'public.refund_ai_job(uuid,text)', 'EXECUTE'),
    'F3 service_role must hold EXECUTE on refund_ai_job';
END $$;

-- F4: the old client-callable refund holes are GONE (dropped, not merely edited)
DO $$ BEGIN
  BEGIN
    PERFORM refund_ai_generation(1, 1, 1);
    RAISE EXCEPTION 'F4a FAIL: refund_ai_generation should be dropped';
  EXCEPTION WHEN undefined_function THEN NULL; END;
  BEGIN
    PERFORM refund_ai_image(5);
    RAISE EXCEPTION 'F4b FAIL: refund_ai_image should be dropped';
  EXCEPTION WHEN undefined_function THEN NULL; END;
END $$;

-- F5: image job refund via refund_ai_job restores credits AND decrements image_jobs
DO $$ DECLARE v_uid uuid := auth.uid(); j jsonb; ref text; b int; jobs int; BEGIN
  j := record_ai_image();           -- debit 5 (balance 10 → 5), image_jobs +1
  ref := j->>'job_ref';
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT b = 5, format('F5 post-spend balance %s', b);
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM refund_ai_job(v_uid, ref);
  SELECT balance INTO b FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT image_jobs INTO jobs FROM ai_generation_usage WHERE user_id = v_uid;
  ASSERT b = 10 AND jobs = 0, format('F5 after refund b=%s jobs=%s', b, jobs);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- G. Per-user isolation — one user's usage never bleeds into another (u5)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  :'u5', false);
DO $$ DECLARE j jsonb; BEGIN
  j := record_ai_generation('cards', 3);
  ASSERT (j->>'remaining_free')::int = 7 AND (j->>'free_now')::int = 3,
    format('G1 fresh user must start clean, got %s', j::text);
END $$;

SELECT 'ALL_AI_CREDIT_METERING_TESTS_PASSED' AS result;
