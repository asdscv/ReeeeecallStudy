-- ============================================================================
-- 원장은 **무엇을 팔았는지** 말해야 한다.
--
-- 소유자가 자기 사용 내역을 보고 "방금 카드 만들었는데 왜 안 떠?"를 물었습니다. 정작 떠
-- 있던 두 줄은 이렇게 적혀 있었습니다:
--
--       AI 카드 생성   −$0.0012
--       AI 카드 생성   −$0.0014
--
-- 둘 다 카드 생성이 아니었습니다. `ai_generation_jobs` 로 조회하면 `remediation`, 즉 카드
-- **설명**입니다. `charge_ai_generation` 이 무엇을 팔았든 `reason = 'spend'` 하나만 썼고,
-- 화면은 그 한 문자열을 "AI 카드 생성"으로 그렸습니다.
--
-- 이 파일은 종류마다 다른 이유가 적히는지 봅니다. 그리고 **로케일 파일이 그 이유를 아는지**는
-- `wallet-reason-labels.test.ts` 가 봅니다 — 서버가 새 이유를 쓰기 시작했는데 번역이 없으면
-- 화면에 `spend_quiz` 같은 날 문자열이 그대로 찍힙니다. 실제로 프로덕션에서 52건 그랬습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d7000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'd7000000-0000-4000-8000-000000000001';
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_goal uuid;
  v_ref  text;
  v_reason text;
  v_price bigint;
BEGIN
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 100000000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 100000000;
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_uid, 'general', '원장 테스트 목표', 20) RETURNING id INTO v_goal;

  -- ══ 1. 카드 생성 → spend_cards ═══════════════════════════════════════════
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 3, 0, 'legacy_generation', 30000);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 400, 500);

  SELECT reason INTO v_reason FROM ai_credit_ledger WHERE ref = v_ref;
  IF v_reason IS DISTINCT FROM 'spend_cards' THEN
    RAISE EXCEPTION 'FAIL: 카드 생성이 % 로 기록됐다', v_reason;
  END IF;

  -- ══ 2. 이미지 → spend_image ══════════════════════════════════════════════
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 0, 1, 'legacy_generation', 100000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 1500, 640);

  SELECT reason INTO v_reason FROM ai_credit_ledger WHERE ref = v_ref;
  IF v_reason IS DISTINCT FROM 'spend_image' THEN
    RAISE EXCEPTION 'FAIL: 이미지가 % 로 기록됐다', v_reason;
  END IF;

  -- ══ 3. 카드 설명 → spend_remediation ═════════════════════════════════════
  --
  -- 소유자가 실제로 본 그 두 줄입니다.
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 500000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 1100, 300);

  SELECT reason INTO v_reason FROM ai_credit_ledger WHERE ref = v_ref;
  IF v_reason IS DISTINCT FROM 'spend_remediation' THEN
    RAISE EXCEPTION 'FAIL: 카드 설명이 % 로 기록됐다 (바로 이 줄이 "AI 카드 생성"으로 보였다)', v_reason;
  END IF;

  -- ══ 4. 학습 진단 → spend_diagnosis ═══════════════════════════════════════
  --
  -- 설명과 진단은 둘 다 job_kind = 'remediation' 입니다. 가르는 것은 목표가 달렸는지뿐이고
  -- (246), 값이 다르므로 학습자에게도 달리 보여야 합니다.
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, remediation_goal_id, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', v_goal, 300000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 2500, 400);

  SELECT reason INTO v_reason FROM ai_credit_ledger WHERE ref = v_ref;
  IF v_reason IS DISTINCT FROM 'spend_diagnosis' THEN
    RAISE EXCEPTION 'FAIL: 학습 진단이 % 로 기록됐다', v_reason;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- ══ 5. 그리고 카드 값은 1센트다 ══════════════════════════════════════════
  SELECT price_micro INTO v_price FROM ai_action_prices WHERE action = 'card';
  IF v_price <> 10000 THEN
    RAISE EXCEPTION 'FAIL: 카드 한 장이 % micro (=$%)', v_price, v_price / 1000000.0;
  END IF;

  RAISE NOTICE 'ledger_reason_test: all assertions passed';
END $$;

ROLLBACK;
