-- ============================================================================
-- 학습자가 문항을 평가할 수 있고, 그 평가가 나중에 읽을 수 있어야 한다.
--
-- 퀴즈 문항은 전부 모델이 씁니다. 그런데 그것이 좋았는지 나빴는지를 아는 경로가 하나도
-- 없었습니다 — 이상한 문제를 만난 학습자는 그냥 넘어가고, 다음에도 같은 프롬프트로 같은
-- 문제가 나옵니다.
--
-- 여기서 검사하는 것:
--   1. 답한 문항만 평가할 수 있다 (답 전에 "정답이 틀렸다"를 고를 수 있으면 정답 탐색이 된다)
--   2. 남의 문항은 평가할 수 없다
--   3. 한 사람 한 문항 한 평가 — 마음이 바뀌면 덮어쓴다
--   4. 👍 로 바꾸면 👎 이유가 남지 않는다
--   5. 집계에 필요한 것이 복사돼 있다 (문항이 지워져도 읽을 수 있게)
--   6. 이유는 선택이고, 닫힌 집합이다
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d9000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('d9000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'd9000000-0000-4000-8000-000000000001';
  v_other uuid := 'd9000000-0000-4000-8000-000000000002';
  v_tmpl  uuid; v_deck uuid; v_card uuid;
  v_set   uuid; v_q uuid; v_run uuid; v_item uuid; v_item2 uuid;
  v_oset  uuid; v_oq uuid; v_orun uuid; v_oitem uuid;
  v_odeck uuid; v_ocard uuid; v_otmpl uuid;
  r       jsonb;
  v_row   quiz_item_feedback%ROWTYPE;
  v_n     integer;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'fb deck', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"lend","field_2":"빌려주다","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, 'fb set', 'mcq', 'deck', 2, 2, 'ready', 'ko')
    RETURNING id INTO v_set;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_set, v_uid, v_card, 'mcq', 1, 'lend 의 뜻으로 옳은 것은?',
            ARRAY['빌려주다','빌리다','갚다','임대하다'], 0, '빌려주다', 'fp1')
    RETURNING id INTO v_q;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_set, v_uid, v_card, 'mcq', 2, '두 번째 문항',
            ARRAY['빌려주다','빌리다','갚다','임대하다'], 0, '빌려주다', 'fp2');

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  SELECT i.id INTO v_item  FROM quiz_run_items i WHERE i.run_id = v_run AND i.question_id = v_q;
  SELECT i.id INTO v_item2 FROM quiz_run_items i WHERE i.run_id = v_run AND i.id <> v_item LIMIT 1;

  -- ══ 1. 답하기 전에는 평가할 수 없다 ══════════════════════════════════════
  BEGIN
    PERFORM public.rate_quiz_item(v_item, 'bad', 'answer_wrong');
    RAISE EXCEPTION 'FAIL: 답하지 않은 문항을 평가했다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- 정답을 골라 답합니다.
  PERFORM public.submit_quiz_answer(v_item, jsonb_build_object(
    'choice', (SELECT k - 1
                 FROM quiz_run_items i, unnest(i.option_order) WITH ORDINALITY AS o(v, k)
                WHERE i.id = v_item AND o.v = 0)));

  -- ══ 2. 이유 없는 👎 도 기록된다 ══════════════════════════════════════════
  --
  -- 이유를 필수로 만들면 두 번째 탭이 생기고, 두 번째 탭이 생기면 아무도 첫 번째를 안 누릅니다.
  PERFORM public.rate_quiz_item(v_item, 'bad');
  SELECT * INTO v_row FROM quiz_item_feedback WHERE user_id = v_uid AND run_item_id = v_item;
  IF v_row.verdict <> 'bad' OR v_row.reason IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: 이유 없는 평가가 % / % 로 저장됐다', v_row.verdict, v_row.reason;
  END IF;

  -- ══ 3. 집계에 필요한 것이 복사돼 있다 ════════════════════════════════════
  --
  -- 문항이 지워지면 join 할 대상이 없습니다. 그때 "어떤 종류·어떤 언어의 문항이 나쁜 평을
  -- 받았나"를 못 읽으면 평가가 남아도 쓸모가 없습니다.
  IF v_row.question_type IS DISTINCT FROM 'mcq'
     OR v_row.content_locale IS DISTINCT FROM 'ko'
     OR v_row.was_correct IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: 사본이 비어 있다 (type=% loc=% correct=%)',
      v_row.question_type, v_row.content_locale, v_row.was_correct;
  END IF;

  -- ══ 4. 한 사람 한 문항 한 평가, 이유는 덮어쓴다 ══════════════════════════
  PERFORM public.rate_quiz_item(v_item, 'bad', 'options_confusing');
  SELECT count(*) INTO v_n FROM quiz_item_feedback WHERE user_id = v_uid AND run_item_id = v_item;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: 같은 문항에 평가가 % 개', v_n; END IF;
  SELECT * INTO v_row FROM quiz_item_feedback WHERE user_id = v_uid AND run_item_id = v_item;
  IF v_row.reason <> 'options_confusing' THEN
    RAISE EXCEPTION 'FAIL: 이유가 갱신되지 않았다 (%)', v_row.reason;
  END IF;

  -- 👍 로 바꾸면 옛 이유가 남으면 안 됩니다 — "좋다고 했는데 보기가 헷갈린다"는 행이 생깁니다.
  PERFORM public.rate_quiz_item(v_item, 'good');
  SELECT * INTO v_row FROM quiz_item_feedback WHERE user_id = v_uid AND run_item_id = v_item;
  IF v_row.verdict <> 'good' OR v_row.reason IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: 👍 로 바꿨는데 이유가 % 로 남았다', v_row.reason;
  END IF;

  -- ══ 5. 모르는 판정·이유는 거절한다 ═══════════════════════════════════════
  BEGIN
    PERFORM public.rate_quiz_item(v_item, 'meh');
    RAISE EXCEPTION 'FAIL: 모르는 판정이 통과했다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.rate_quiz_item(v_item, 'bad', 'i_just_dont_like_it');
    RAISE EXCEPTION 'FAIL: 모르는 이유가 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 6. 남의 문항은 평가할 수 없다 ════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT id INTO v_otmpl FROM card_templates WHERE user_id = v_other AND name = '영어 단어';
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_other, 'other deck', v_otmpl)
    RETURNING id INTO v_odeck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_odeck, v_other, v_otmpl, '{"field_1":"a","field_2":"에이","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_ocard;
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_other, v_odeck, 'other set', 'mcq', 'deck', 1, 1, 'ready', 'en')
    RETURNING id INTO v_oset;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_oset, v_other, v_ocard, 'mcq', 1, 'other', ARRAY['a','b','c','d'], 0, 'a', 'ofp')
    RETURNING id INTO v_oq;
  INSERT INTO quiz_runs (user_id, set_id, attempt_no, item_count) VALUES (v_other, v_oset, 1, 1)
    RETURNING id INTO v_orun;
  INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
    VALUES (v_orun, v_oq, 1, ARRAY[0,1,2,3]::smallint[]) RETURNING id INTO v_oitem;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.rate_quiz_item(v_oitem, 'bad', 'answer_wrong');
    RAISE EXCEPTION 'FAIL: 남의 문항을 평가했다';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ══ 7. 그리고 프롬프트를 고칠 때 던지는 질문이 실제로 돌아간다 ═══════════
  --
  -- 이 표가 존재하는 이유입니다. 이 질문이 안 돌아가면 데이터만 쌓입니다.
  PERFORM public.submit_quiz_answer(v_item2, jsonb_build_object('choice', 1));
  PERFORM public.rate_quiz_item(v_item2, 'bad', 'question_unclear');

  SELECT count(*) INTO v_n FROM (
    SELECT question_type, reason, count(*) AS n
      FROM quiz_item_feedback
     WHERE verdict = 'bad' AND user_id = v_uid
     GROUP BY question_type, reason) g;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'FAIL: 종류·이유별 집계가 비었다';
  END IF;

  RAISE NOTICE 'quiz_item_feedback_test: all assertions passed';
END $$;

ROLLBACK;
