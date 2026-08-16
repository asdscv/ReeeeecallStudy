-- ============================================================================
-- 무료 정책이 데이터인가.
--
-- 요구사항은 "무료 문항이 5개다"가 아닙니다. **5를 8로 바꾸거나, 유료 티어에 20을 주거나,
-- 채점에 하루 한 건을 열어주는 데 배포가 필요 없어야 한다**는 것입니다. 그래서 이 파일은
-- 숫자를 확인하는 게 아니라, 숫자를 바꿨을 때 동작이 따라오는지를 확인합니다.
--
-- (`quiz_difficulty_test.sql`이 난이도 밴드에 대해 같은 요구를 겁니다. 이건 그 규칙을 무료
--  정책으로 옮긴 것입니다.)
--
-- 함께 확인하는 것: 무료 한도가 **문항** 단위라는 것. 예전에는 유닛이라 하루 10유닛이
-- 객관식 5문항 또는 서술형 3문항이었고, 어떤 숫자를 넣어도 "유형 상관없이 5개"를 쓸 수
-- 없었습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('fb000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid uuid := 'fb000000-0000-4000-8000-000000000001';
  q     jsonb;
  a     record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  -- 체험 유닛은 이 테스트의 관심사가 아닙니다. 있으면 무료분보다 먼저 소진되어 숫자를 가립니다.
  DELETE FROM ai_quiz_trial WHERE user_id = v_uid;

  -- ── 1. 유형과 무관하게 5문항 ──────────────────────────────────────────────
  -- 서술형은 문항당 3유닛입니다. 유닛 시절 하루 10유닛으로는 3문항이 한계였습니다.
  q := get_ai_quiz_quote('generate_essay', 5);
  IF (q ->> 'free_items')::int <> 5 OR (q ->> 'paid_items')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: 서술형 5문항이 전부 무료여야 하는데 free=% paid=%',
      q ->> 'free_items', q ->> 'paid_items';
  END IF;
  -- 그리고 객관식도 똑같이 5문항. 유형이 한도를 바꾸지 않는다는 것이 요청의 핵심입니다.
  q := get_ai_quiz_quote('generate_mcq', 5);
  IF (q ->> 'free_items')::int <> 5 THEN
    RAISE EXCEPTION 'FAIL: 객관식 5문항이 무료가 아님 (free=%)', q ->> 'free_items';
  END IF;

  -- 6문항째는 유료. 한도는 한도입니다.
  q := get_ai_quiz_quote('generate_essay', 6);
  IF (q ->> 'free_items')::int <> 5 OR (q ->> 'paid_items')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: 6문항 요청에서 5무료/1유료가 아님 (free=% paid=%)',
      q ->> 'free_items', q ->> 'paid_items';
  END IF;
  -- 가격은 유료 문항만. 서술형 1문항 = 3유닛 × 단가.
  IF (q ->> 'price_micro')::bigint <>
     3::bigint * (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: 유료 1문항의 가격이 3유닛이 아님 (%)', q ->> 'price_micro';
  END IF;

  -- ── 2. 숫자는 UPDATE 한 줄로 바뀐다 ───────────────────────────────────────
  UPDATE ai_free_allowances SET per_day = 8 WHERE tier = 'free' AND action_group = 'quiz_generate';
  q := get_ai_quiz_quote('generate_essay', 8);
  IF (q ->> 'free_items')::int <> 8 THEN
    RAISE EXCEPTION 'FAIL: 한도를 8로 바꿨는데 무료가 % 문항', q ->> 'free_items';
  END IF;
  UPDATE ai_free_allowances SET per_day = 5 WHERE tier = 'free' AND action_group = 'quiz_generate';

  -- ── 3. 티어 추가는 INSERT 한 줄 ───────────────────────────────────────────
  INSERT INTO ai_free_allowances (tier, action_group, per_day, unit_kind, trial_applies)
    VALUES ('pro', 'quiz_generate', 20, 'item', true);
  -- 새 계정에도 이미 active 'free' 구독 행이 있고, 활성 구독은 사용자당 하나라는 부분 유니크
  -- 인덱스가 걸려 있습니다. 그래서 INSERT가 아니라 티어를 올립니다 — 실제 업그레이드가
  -- 하는 일도 이것입니다.
  UPDATE subscriptions SET tier = 'pro' WHERE user_id = v_uid AND status = 'active';
  IF NOT FOUND THEN
    INSERT INTO subscriptions (user_id, tier, status) VALUES (v_uid, 'pro', 'active');
  END IF;
  q := get_ai_quiz_quote('generate_essay', 12);
  IF (q ->> 'free_items')::int <> 12 THEN
    RAISE EXCEPTION 'FAIL: pro 티어가 무료 12문항을 못 받음 (free=%)', q ->> 'free_items';
  END IF;
  -- 그 티어의 행을 지우면 'free'로 떨어진다 — 폴백이 있어야 티어를 실험할 수 있습니다.
  DELETE FROM ai_free_allowances WHERE tier = 'pro';
  q := get_ai_quiz_quote('generate_essay', 12);
  IF (q ->> 'free_items')::int <> 5 THEN
    RAISE EXCEPTION 'FAIL: 티어 행이 없을 때 free 폴백이 안 됨 (free=%)', q ->> 'free_items';
  END IF;
  UPDATE subscriptions SET tier = 'free' WHERE user_id = v_uid;

  -- ── 4. 채점이 무료가 아닌 것도 데이터 ─────────────────────────────────────
  -- 233은 이걸 `IF p_action LIKE 'grade\_%'`로 코드에 박았습니다. 이제 행 하나입니다.
  q := get_ai_quiz_quote('grade_essay', 1);
  IF (q ->> 'free_items')::int <> 0 OR (q ->> 'trial_items')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: 채점에 무료/체험이 붙음 (free=% trial=%)',
      q ->> 'free_items', q ->> 'trial_items';
  END IF;
  -- 그리고 열어주고 싶으면 UPDATE 한 줄이면 된다는 것도 같이 증명합니다.
  UPDATE ai_free_allowances SET per_day = 1 WHERE tier = 'free' AND action_group = 'quiz_grade';
  q := get_ai_quiz_quote('grade_essay', 1);
  IF (q ->> 'free_items')::int <> 1 OR (q ->> 'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: 채점 무료 1건을 데이터로 열 수 없음 (free=% price=%)',
      q ->> 'free_items', q ->> 'price_micro';
  END IF;
  UPDATE ai_free_allowances SET per_day = 0 WHERE tier = 'free' AND action_group = 'quiz_grade';

  -- ── 5. 테이블에 없는 행동은 무료가 아니다 ─────────────────────────────────
  -- 새 AI 기능을 붙이면서 정책 행을 깜빡했을 때, 조용히 공짜가 되는 쪽이 훨씬 비쌉니다.
  SELECT * INTO a FROM _ai_free_allowance(v_uid, 'a_feature_nobody_seeded');
  IF a.per_day <> 0 THEN
    RAISE EXCEPTION 'FAIL: 등록되지 않은 행동이 무료 %개', a.per_day;
  END IF;

  -- ── 6. 예전 방식으로 되돌리는 것도 데이터 ─────────────────────────────────
  -- unit_kind = 'unit'이면 유형 가중치가 다시 붙습니다. 하루 10유닛 = 서술형 3문항.
  UPDATE ai_free_allowances SET unit_kind = 'unit', per_day = 10
   WHERE tier = 'free' AND action_group = 'quiz_generate';
  q := get_ai_quiz_quote('generate_essay', 5);
  IF (q ->> 'free_items')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: unit 방식에서 서술형 무료가 3문항이 아님 (free=%)', q ->> 'free_items';
  END IF;
  UPDATE ai_free_allowances SET unit_kind = 'item', per_day = 5
   WHERE tier = 'free' AND action_group = 'quiz_generate';

  -- ── 7. 카드도 같은 테이블에서 ─────────────────────────────────────────────
  IF public._ai_free_cards_per_day() <> 10 THEN
    RAISE EXCEPTION 'FAIL: 무료 카드가 10장이 아님 (%)', public._ai_free_cards_per_day();
  END IF;
  UPDATE ai_free_allowances SET per_day = 25 WHERE tier = 'free' AND action_group = 'card';
  IF public._ai_free_cards_per_day() <> 25 THEN
    RAISE EXCEPTION 'FAIL: 카드 한도 변경이 반영되지 않음 (%)', public._ai_free_cards_per_day();
  END IF;
  UPDATE ai_free_allowances SET per_day = 10 WHERE tier = 'free' AND action_group = 'card';

  -- ── 8. 결제 안내는 무료 요금제를 광고한다, 부르는 사람의 요금제가 아니라 ──
  --
  -- `get_plan_limits()`는 비로그인 사용자도 부르는 결제 안내입니다. 239는 이걸 부르는 사람의
  -- 티어로 답하게 만들었고, 오늘은 'free' 행만 있어서 차이가 없었습니다. 차이가 생기는 순간이
  -- 정확히 이 커널이 광고하는 그 INSERT입니다 — 그래서 그 INSERT를 여기서 해 봅니다.
  INSERT INTO ai_free_allowances (tier, action_group, per_day, unit_kind, trial_applies)
    VALUES ('pro', 'card', 200, 'item', false);
  UPDATE subscriptions SET tier = 'pro' WHERE user_id = v_uid AND status = 'active';

  IF (get_plan_limits() ->> 'free_ai_cards_per_day')::int <> 10 THEN
    RAISE EXCEPTION 'FAIL: 결제 안내가 무료 요금제(10)가 아니라 %를 광고한다',
      get_plan_limits() ->> 'free_ai_cards_per_day';
  END IF;
  -- 그리고 그 사용자 자신의 한도는 여전히 200이어야 합니다 — 둘은 다른 질문입니다.
  IF public._ai_free_cards_per_day() <> 200 THEN
    RAISE EXCEPTION 'FAIL: pro 사용자의 실제 한도가 200이 아니다 (%)', public._ai_free_cards_per_day();
  END IF;

  DELETE FROM ai_free_allowances WHERE tier = 'pro';
  UPDATE subscriptions SET tier = 'free' WHERE user_id = v_uid;

  RAISE NOTICE 'ai_free_allowance_test: all assertions passed';
END $$;

ROLLBACK;
