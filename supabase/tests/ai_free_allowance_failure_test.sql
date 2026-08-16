-- ============================================================================
-- 무료 정책 커널의 실패 경로.
--
-- `ai_free_allowance_test.sql`은 정책이 데이터인지를 봅니다. 이 파일은 **일이 잘못됐을 때**를
-- 봅니다 — 239의 결함 셋이 전부 여기 숨어 있었고, 정상 경로에서는 하나도 보이지 않았습니다.
-- 생성이 성공하고, 전부 배달되고, 아무도 동시에 누르지 않으면 239는 완벽해 보입니다.
--
-- 셋 다 적대적 리뷰가 찾았고, 셋 다 프로덕션에 이미 적용된 뒤였습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('fc000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'fc000000-0000-4000-8000-000000000001';
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  r        jsonb;
  v_settle jsonb;
  v_items  integer;
  v_units  integer;
  v_price  bigint;
  v_bal    bigint;
BEGIN
  DELETE FROM ai_quiz_trial WHERE user_id = v_uid;
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 100000000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 100000000;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- ══ 1. 생성이 실패해도 그날 무료 문항은 살아남는다 ═══════════════════════
  --
  -- 239는 `free_quiz_items_used`를 만들면서 `release_ai_job`을 안 고쳤습니다. 엣지 함수는
  -- 생성 실패마다 그걸 부르고, 유닛만 돌려줬습니다. 그래서 학습자가 재시도하면 30초 전에
  -- 무료였던 다섯 문항이 $0.50이 됩니다 — 아무것도 못 받은 작업 때문에.
  r := reserve_ai_quiz('generate_mcq', 5, gen_random_uuid(), 5000000);
  SELECT free_quiz_items_used INTO v_items
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;
  IF v_items <> 5 THEN RAISE EXCEPTION 'FAIL: 예약이 무료 문항 5개를 안 썼다 (%)', v_items; END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM release_ai_job(v_uid, r ->> 'job_ref');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);

  SELECT free_quiz_items_used, free_quiz_units_used INTO v_items, v_units
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;
  IF v_items <> 0 OR v_units <> 0 THEN
    RAISE EXCEPTION 'FAIL: 실패한 작업이 무료를 돌려주지 않았다 (문항 % 유닛 %)', v_items, v_units;
  END IF;
  -- 그리고 재시도가 다시 무료여야 합니다. 이게 학습자가 실제로 보는 것입니다.
  IF (get_ai_quiz_quote('generate_mcq', 5) ->> 'free_items')::int <> 5 THEN
    RAISE EXCEPTION 'FAIL: 실패 후 재시도가 무료가 아니다';
  END IF;

  -- ══ 2. 정산은 예약이 승인받은 금액을 넘을 수 없다 ═════════════════════════
  --
  -- `unit_kind = 'unit'`은 239가 "UPDATE 한 줄로 되돌릴 수 있다"고 광고하는 모드이고 그
  -- 테스트가 실제로 그 UPDATE를 합니다. 그 모드에서 문항 홀드는 유닛 배분의 내림이라,
  -- 정산이 거기서 무료 유닛을 다시 유도하면 잘린 나머지를 유료로 청구합니다 — 예약이
  -- 잔액검사까지 통과시킨 금액보다 비싸게.
  UPDATE ai_free_allowances SET unit_kind = 'unit', per_day = 10
   WHERE tier = 'free' AND action_group = 'quiz_generate';

  r := reserve_ai_quiz('generate_essay', 5, gen_random_uuid(), 5000000);
  v_price := (r ->> 'price_micro')::bigint;

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  v_settle := settle_ai_quiz(v_uid, r ->> 'job_ref', 5);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);

  IF (v_settle ->> 'price_micro')::bigint > v_price THEN
    RAISE EXCEPTION 'FAIL: 정산 %가 예약 %를 넘었다 (unit 모드)',
      v_settle ->> 'price_micro', v_price;
  END IF;
  -- 전부 배달됐으므로 정확히 같아야 합니다 — "넘지 않음"보다 강한 조건.
  IF (v_settle ->> 'price_micro')::bigint <> v_price THEN
    RAISE EXCEPTION 'FAIL: 전량 배달인데 정산 %가 예약 %와 다르다',
      v_settle ->> 'price_micro', v_price;
  END IF;

  UPDATE ai_free_allowances SET unit_kind = 'item', per_day = 5
   WHERE tier = 'free' AND action_group = 'quiz_generate';

  -- ══ 3. item 모드에서도 같은 성질, 그리고 미달 배달은 학습자에게 유리하게 ══
  DELETE FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;

  -- 8문항 예약 = 무료 5 + 유료 3. 3문항만 배달되면 유료분부터 돌려받아야 합니다.
  r := reserve_ai_quiz('generate_mcq', 8, gen_random_uuid(), 5000000);
  v_price := (r ->> 'price_micro')::bigint;
  IF v_price <> 3::bigint * 2 * (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: 8문항 예약가가 유료 3문항이 아니다 (%)', v_price;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  v_settle := settle_ai_quiz(v_uid, r ->> 'job_ref', 3);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);

  IF (v_settle ->> 'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: 3문항만 배달됐는데 %가 청구됐다 (무료분이 먼저 소진돼야 함)',
      v_settle ->> 'price_micro';
  END IF;
  SELECT free_quiz_items_used INTO v_items
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;
  IF v_items <> 3 THEN
    RAISE EXCEPTION 'FAIL: 배달된 3문항만 무료에서 빠져야 하는데 %개', v_items;
  END IF;

  -- 지갑은 한 번도 음수가 되지 않았습니다.
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF v_bal < 0 THEN RAISE EXCEPTION 'FAIL: 잔액이 음수 (%)', v_bal; END IF;

  RAISE NOTICE 'ai_free_allowance_failure_test: all assertions passed';
END $$;

-- ══ 4. 잠금 순서 ════════════════════════════════════════════════════════════
--
-- 교착은 한 세션짜리 테스트로 재현할 수 없으므로, 재현 대신 **순서 자체**를 고정합니다:
-- 체험 행을 먼저 잠그고 사용량 행을 나중에 잠근다. `settle_ai_quiz`와 `release_ai_job`이
-- 이미 그 순서이고, 239의 예약만 반대였습니다.
DO $$
DECLARE src text; v_trial integer; v_usage integer;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reserve_ai_quiz';

  -- stale 회수 루프 뒤의 본문만 봅니다. 루프 안에도 두 테이블이 나오는데, 거기는 이미
  -- 체험 → 사용량 순서라 여기서 세면 위치가 흐려집니다.
  src := substr(src, position('req_count + 1 > c_max_requests' in src));

  v_trial := position('FROM ai_quiz_trial WHERE user_id = v_uid FOR UPDATE' in src);
  v_usage := position('FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE' in src);
  IF v_trial = 0 THEN RAISE EXCEPTION 'FAIL: 예약이 체험 행을 잠그지 않는다'; END IF;
  IF v_usage <> 0 AND v_trial > v_usage THEN
    RAISE EXCEPTION 'FAIL: 예약이 사용량을 먼저 잠근다 — settle/release와 반대 순서(교착)';
  END IF;
  RAISE NOTICE 'ai_free_allowance_failure_test: lock order 체험 → 사용량 확인';
END $$;

ROLLBACK;
