-- ============================================================================
-- 사용 내역은 AI 를 쓴 것을 **하나도 빠짐없이** 보여줘야 한다.
--
-- 소유자가 카드를 만들고 사용 내역을 열었는데 비어 있었습니다. 차감이 누락된 게 아니라 그
-- 생성이 무료 10장 안이라 잔액이 안 움직였고, 화면은 잔액 변동만 읽고 있었습니다. 학습자
-- 입장에서 "AI 를 썼는데 기록이 없다"는 둘 다 같은 고장입니다.
--
-- 여기서 검사하는 것:
--   1. 무료로 쓴 것도 나온다 (그게 이 RPC 가 생긴 이유)
--   2. 유료로 쓴 것은 **종류마다** 나온다 — 카드·이미지·설명·진단·퀴즈
--   3. 같은 작업이 두 줄로 세어지지 않는다
--   4. 남의 것은 안 나온다
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d8000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('d8000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'd8000000-0000-4000-8000-000000000001';
  v_other uuid := 'd8000000-0000-4000-8000-000000000002';
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_goal  uuid;
  v_ref   text;
  v_n     integer;
  v_kinds text[];
BEGIN
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 100000000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 100000000;
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_uid, 'general', '내역 테스트 목표', 20) RETURNING id INTO v_goal;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ── 무료 카드 생성. 잔액이 안 움직입니다 — 소유자가 겪은 바로 그 경우.
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind)
    VALUES (v_ref, v_uid, v_today, 10, 0, 0, 'legacy_generation');
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 400, 500);

  -- ── 유료 카드 · 이미지 · 카드 설명 · 진단
  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 5, 0, 'legacy_generation', 50000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 400, 500);

  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 0, 1, 'legacy_generation', 100000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 1500, 640);

  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 500000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 1100, 300);

  v_ref := gen_random_uuid()::text;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, remediation_goal_id, fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', v_goal, 300000);
  PERFORM charge_ai_generation(v_uid, v_ref, 'gemini', 'gemini-3.1-flash-lite', 2500, 400);

  -- ── 퀴즈. 유료 한 건, 무료 한 건.
  --
  -- 퀴즈는 `settle_ai_quiz` 가 정산하고 `charged` 는 값이 있을 때만 켭니다. 그래서 무료 퀴즈는
  -- `quiz_units_done` 으로만 알아볼 수 있고, 그 조건이 251 에 따로 들어 있습니다.
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_uid, -100000, 'spend_quiz', gen_random_uuid()::text, 99000000);
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, quiz_units_done)
    VALUES (gen_random_uuid()::text, v_uid, v_today, 0, 0, 0, 'quiz_generate', 4);

  -- ── 남의 무료 생성. 절대 새면 안 됩니다.
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  job_kind, charged)
    VALUES (gen_random_uuid()::text, v_other, v_today, 7, 0, 0, 'legacy_generation', true);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ══ 1. 무료로 쓴 것이 나온다 ═════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM get_ai_usage_history(100, NULL)
   WHERE is_free AND kind = 'spend_cards';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 무료 카드 생성이 % 줄 (0이면 화면이 다시 비어 보인다)', v_n;
  END IF;
  IF (SELECT free_cards FROM get_ai_usage_history(100, NULL)
       WHERE is_free AND kind = 'spend_cards') <> 10 THEN
    RAISE EXCEPTION 'FAIL: 무료 줄이 몇 장이었는지를 말하지 않는다';
  END IF;

  -- ══ 2. 유료도 종류마다 나온다 ════════════════════════════════════════════
  SELECT array_agg(DISTINCT kind ORDER BY kind) INTO v_kinds
    FROM get_ai_usage_history(100, NULL) WHERE NOT is_free;
  IF NOT (v_kinds @> ARRAY['spend_cards','spend_image','spend_remediation',
                           'spend_diagnosis','spend_quiz']) THEN
    RAISE EXCEPTION 'FAIL: 유료 종류가 빠졌다 (%)', v_kinds;
  END IF;

  -- ══ 3. 무료 퀴즈도 나온다 ════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM get_ai_usage_history(100, NULL)
   WHERE is_free AND kind = 'spend_quiz';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 무료 퀴즈가 % 줄', v_n;
  END IF;

  -- ══ 4. 한 작업이 두 줄이 되지 않는다 ═════════════════════════════════════
  --
  -- 값이 붙은 작업은 원장에 행이 있고, 무료 쪽 조건은 값이 0인 것만 고릅니다. 두 조건이
  -- 겹치면 유료 사용이 "무료"로 한 번 더 세어져 학습자가 쓴 것보다 많이 쓴 것처럼 보입니다.
  SELECT count(*) INTO v_n FROM get_ai_usage_history(100, NULL) WHERE is_free;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: 무료 줄이 % 개 (카드 1 + 퀴즈 1 이어야 한다)', v_n;
  END IF;

  -- ══ 5. 남의 것은 안 나온다 ═══════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM get_ai_usage_history(100, NULL) WHERE free_cards = 7;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: 남의 무료 생성이 보인다';
  END IF;

  -- ══ 6. 시간 커서로 넘긴다 ════════════════════════════════════════════════
  --
  -- 두 표를 섞으면 id 가 한 줄로 서지 않아 시각으로 넘깁니다. 커서보다 **이전** 것만
  -- 나와야 하고, 아니면 무한 스크롤이 같은 페이지를 반복합니다.
  IF EXISTS (SELECT 1 FROM get_ai_usage_history(100, now() - interval '1 day')) THEN
    RAISE EXCEPTION 'FAIL: 커서보다 나중 행이 나왔다';
  END IF;

  RAISE NOTICE 'usage_history_test: all assertions passed';
END $$;

ROLLBACK;
