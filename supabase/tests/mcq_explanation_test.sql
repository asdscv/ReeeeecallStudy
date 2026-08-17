-- ============================================================================
-- 객관식 AI 해설은 점수를 건드리지 않는다.
--
-- 요청은 "객관식도 그냥 다 ai 채점하자" 였고, 245 는 그것을 **해설**로 구현했습니다. 이유는
-- 하나입니다: 객관식의 정답은 우리가 쓴 정답표와의 정수 비교라, 모델이 거기에 보탤 수 있는
-- 것이 없습니다. 동의하거나(무의미), 반대하거나(결함), 동의하는 데 돈이 들거나 셋뿐입니다.
--
-- 그래서 경계가 이 파일의 전부입니다:
--
--   정답 판정  → `submit_quiz_answer`, 제출 시점, 무료, 확정
--   해설       → `apply_quiz_explanation`, 학습자가 요청할 때, 유료
--
-- 이 경계가 무너지는 방식은 조용합니다. 해설이 `normalized_score` 를 스치기만 해도, 맞은 답이
-- 틀렸다고 뒤집히는 날이 오고 학습자에게 남는 것은 이의제기 버튼뿐입니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d5000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'd5000000-0000-4000-8000-000000000001';
  v_tmpl  uuid; v_deck uuid; v_card uuid;
  v_set   uuid; v_q uuid; v_run uuid; v_item uuid;
  res     jsonb;
  v_score numeric;
  v_raw   numeric;
  v_units smallint;
  v_status text;
  v_fb    jsonb;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'mcq deck', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"lend","field_2":"빌려주다","field_3":"lend","field_4":"I lend it"}'::jsonb)
    RETURNING id INTO v_card;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, 'mcq set', 'mcq', 'deck', 1, 1, 'ready', 'ko')
    RETURNING id INTO v_set;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_set, v_uid, v_card, 'mcq', 1, 'lend 의 뜻으로 옳은 것은?',
            ARRAY['빌려주다','빌리다','갚다','임대하다'], 0, '빌려주다', 'fp1')
    RETURNING id INTO v_q;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  res := public.start_quiz_run(v_set);
  v_run := (res->>'run_id')::uuid;
  SELECT id INTO v_item FROM quiz_run_items WHERE run_id = v_run ORDER BY position LIMIT 1;

  -- ══ 1. 제출만으로 채점이 끝난다 ═══════════════════════════════════════════
  -- 정답의 표시 위치. `option_order` 는 섞인 순서라 정답(정규 index 0)이 몇 번째로 보이는지는
  -- 매번 다릅니다.
  res := public.submit_quiz_answer(v_item, jsonb_build_object(
    'choice', (SELECT k - 1
                 FROM quiz_run_items i, unnest(i.option_order) WITH ORDINALITY AS o(v, k)
                WHERE i.id = v_item AND o.v = 0)));
  IF (res->>'score')::numeric <> 1 THEN
    RAISE EXCEPTION 'FAIL: 정답을 골랐는데 점수가 % (제출 시점 채점이 깨졌다)', res->>'score';
  END IF;
  IF (res->>'graded')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 객관식이 채점되지 않은 채로 남았다 — 즉시 판정이 기능이다';
  END IF;

  SELECT normalized_score INTO v_score FROM answer_attempts WHERE quiz_run_item_id = v_item;
  SELECT score_raw INTO v_raw FROM quiz_runs WHERE id = v_run;
  SELECT status INTO v_status FROM quiz_run_items WHERE id = v_item;

  -- ══ 2. 해설은 점수·상태·집계를 스치지 않는다 ═════════════════════════════
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.apply_quiz_explanation(
    v_item,
    jsonb_build_object('mcq_explanation', jsonb_build_object('axis', 'direction')),
    jsonb_build_object('axis', 'direction',
                       'spans', jsonb_build_array(
                         jsonb_build_object('from', 'reference', 'start', 0, 'end', 5))),
    'test:model');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF (SELECT normalized_score FROM answer_attempts WHERE quiz_run_item_id = v_item) <> v_score THEN
    RAISE EXCEPTION 'FAIL: 해설이 점수를 바꿨다 — 정답표가 있는 문제를 모델이 뒤집는다';
  END IF;
  IF (SELECT score_raw FROM quiz_runs WHERE id = v_run) <> v_raw THEN
    RAISE EXCEPTION 'FAIL: 해설이 런 집계를 바꿨다';
  END IF;
  IF (SELECT status FROM quiz_run_items WHERE id = v_item) <> v_status THEN
    RAISE EXCEPTION 'FAIL: 해설이 항목 상태를 바꿨다';
  END IF;
  IF (SELECT evaluator_type FROM answer_attempts WHERE quiz_run_item_id = v_item) <> 'choice' THEN
    RAISE EXCEPTION 'FAIL: 해설이 채점자를 AI 로 바꿔 놨다 — 채점한 것은 SQL 이다';
  END IF;

  -- 산 것은 남아야 합니다.
  SELECT feedback INTO v_fb FROM answer_attempts WHERE quiz_run_item_id = v_item;
  IF v_fb ->> 'axis' <> 'direction' THEN
    RAISE EXCEPTION 'FAIL: 해설이 저장되지 않았다 (%)', v_fb;
  END IF;
  -- 제출 시점의 판정도 함께 남습니다 — 덮어쓰기가 아니라 병합입니다.
  IF (SELECT evaluator_result -> 'mcq_explanation' ->> 'axis'
        FROM answer_attempts WHERE quiz_run_item_id = v_item) <> 'direction' THEN
    RAISE EXCEPTION 'FAIL: evaluator_result 에 해설이 병합되지 않았다';
  END IF;

  -- ══ 3. 값은 가격표에 있고, 채점보다 싸다 ═════════════════════════════════
  SELECT units INTO v_units FROM ai_quiz_price_units WHERE action = 'grade_mcq';
  IF v_units IS NULL THEN
    RAISE EXCEPTION 'FAIL: grade_mcq 가 가격표에 없다 — 엣지가 예약을 못 한다';
  END IF;
  IF v_units >= (SELECT units FROM ai_quiz_price_units WHERE action = 'grade_short') THEN
    RAISE EXCEPTION 'FAIL: 해설(%)이 주관식 채점보다 싸지 않다', v_units;
  END IF;

  -- ══ 4. 학습자는 남의 해설을 붙일 수 없다 ═════════════════════════════════
  BEGIN
    PERFORM public.apply_quiz_explanation(v_item, '{}'::jsonb, '{}'::jsonb, 'x');
    RAISE EXCEPTION 'FAIL: authenticated 가 해설을 직접 붙일 수 있다';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'mcq_explanation_test: all assertions passed';
END $$;

ROLLBACK;
