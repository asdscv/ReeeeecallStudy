-- ============================================================================
-- 주간 띠는 학습플랜에서 답한 것도 세어야 한다.
--
-- `get_plan_digest` 의 `touched` 는 `study_rating_events` 와 `study_logs` 만 봤습니다. 둘 다
-- 덱 학습 세션의 기록입니다. 학습플랜 화면에서 답하는 것 — 오늘의 확인, 퀴즈, 플랜 항목의
-- 모름/애매함/알았음 — 은 하나도 그 세션이 아니고 전부 `answer_attempts` 에만 남습니다.
--
-- 그래서 같은 화면이 스스로 모순됐습니다: 위쪽 "오늘의 학습 기록"은 오늘 답한 것을 세어
-- 보여주는데, 두 뼘 아래 주간 띠는 같은 날을 빈 칸으로 두고 "이번 주는 아직 기록이 없어요".
-- 프로덕션 계정에서 34번 답한 닷새가 전부 빈 칸이었습니다.
--
-- 이 테스트는 **덱 학습 세션을 한 번도 하지 않은** 학습자를 만듭니다. 243 이전에는 그런
-- 학습자의 `studied` 가 무엇을 하든 0 이었습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('fd000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'fd000000-0000-4000-8000-000000000001';
  v_tpl   uuid; v_deck uuid; v_goal uuid;
  v_card1 uuid; v_card2 uuid;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  r        jsonb;
  v_studied integer;
BEGIN
  SELECT id INTO v_tpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'digest deck', v_tpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tpl, '{"field_1":"a","field_2":"에이","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card1;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tpl, '{"field_1":"b","field_2":"비","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card2;

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_uid, 'general', '띠 테스트 목표', 20) RETURNING id INTO v_goal;
  INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES (v_goal, v_deck);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- ══ 1. 아무것도 안 했으면 오늘은 0 ═══════════════════════════════════════
  r := get_plan_digest(v_goal, 'UTC', 7);
  SELECT (d ->> 'studied')::int INTO v_studied
    FROM jsonb_array_elements(r -> 'by_day') d
   WHERE d ->> 'date' = to_char(v_today, 'YYYY-MM-DD');
  IF v_studied <> 0 THEN
    RAISE EXCEPTION 'FAIL: 학습 전인데 studied 가 % 다', v_studied;
  END IF;

  -- ══ 2. 학습플랜에서 답한 것이 세어진다 ═══════════════════════════════════
  --
  -- 플랜 항목 없는 시도 — 프로덕션의 48행이 전부 이 모양입니다(퀴즈·오늘의 확인·244 의 약한
  -- 카드 평점이 모두 직접 INSERT 로 남깁니다).
  INSERT INTO answer_attempts (user_id, goal_id, card_id, client_attempt_id,
                               activity_type, response_type, evaluator_type,
                               response, normalized_score, duration_ms)
    VALUES (v_uid, v_goal, v_card1, gen_random_uuid(),
            'recall', 'self_rate', 'self_rate', '{"self_rated":0}'::jsonb, 0.0, 0);

  r := get_plan_digest(v_goal, 'UTC', 7);
  SELECT (d ->> 'studied')::int INTO v_studied
    FROM jsonb_array_elements(r -> 'by_day') d
   WHERE d ->> 'date' = to_char(v_today, 'YYYY-MM-DD');
  IF v_studied <> 1 THEN
    RAISE EXCEPTION 'FAIL: 학습플랜에서 한 장 답했는데 studied 가 % 다 — 주간 띠가 빈 칸으로 남는다', v_studied;
  END IF;

  -- ══ 3. 같은 카드를 여러 번 답해도 한 장 ══════════════════════════════════
  --
  -- `studied` 는 `count(DISTINCT card_id)` 입니다. 한 카드를 세 번 틀렸다고 세 장을 학습한 것이
  -- 아닙니다 — 이 성질은 arm 을 늘리면서 깨지기 쉬운 쪽입니다.
  INSERT INTO answer_attempts (user_id, goal_id, card_id, client_attempt_id,
                               activity_type, response_type, evaluator_type,
                               response, normalized_score, duration_ms)
    VALUES (v_uid, v_goal, v_card1, gen_random_uuid(),
            'recall', 'self_rate', 'self_rate', '{"self_rated":0.5}'::jsonb, 0.5, 0);

  r := get_plan_digest(v_goal, 'UTC', 7);
  SELECT (d ->> 'studied')::int INTO v_studied
    FROM jsonb_array_elements(r -> 'by_day') d
   WHERE d ->> 'date' = to_char(v_today, 'YYYY-MM-DD');
  IF v_studied <> 1 THEN
    RAISE EXCEPTION 'FAIL: 같은 카드 두 번 답한 것이 % 장으로 세어졌다', v_studied;
  END IF;

  -- ══ 4. 덱 학습 세션과 중복 계산하지 않는다 ═══════════════════════════════
  --
  -- 같은 날 카드1을 덱에서도 학습하고 플랜에서도 답했으면 한 장입니다. 두 기록자가 겹치는
  -- 지점이라, `UNION ALL` + `DISTINCT` 가 아니라 그냥 합계였다면 여기서 2가 됩니다.
  INSERT INTO study_logs (user_id, card_id, deck_id, studied_at, rating, study_mode)
    VALUES (v_uid, v_card1, v_deck, now(), 'good', 'srs');
  -- 그리고 카드2는 덱에서만 학습 → 이제 서로 다른 두 장
  INSERT INTO study_logs (user_id, card_id, deck_id, studied_at, rating, study_mode)
    VALUES (v_uid, v_card2, v_deck, now(), 'good', 'srs');

  r := get_plan_digest(v_goal, 'UTC', 7);
  SELECT (d ->> 'studied')::int INTO v_studied
    FROM jsonb_array_elements(r -> 'by_day') d
   WHERE d ->> 'date' = to_char(v_today, 'YYYY-MM-DD');
  IF v_studied <> 2 THEN
    RAISE EXCEPTION 'FAIL: 카드 두 장인데 studied 가 % 다 (두 기록자가 겹치는 카드를 두 번 셌다)', v_studied;
  END IF;

  RAISE NOTICE 'plan_digest_counts_attempts_test: all assertions passed';
END $$;

ROLLBACK;
