-- ============================================================================
-- 길이 상한은 **쓰는 자리**에 있어야 한다.
--
-- 상한이 없었던 게 아니라 엉뚱한 곳에 있었습니다. `MAX_LEARNER_CHARS`(서술형 2000, 주관식
-- 300)는 `gradeGate` 안에 있고 그것은 **채점할 때** 돕니다. 채점은 학습자가 누르는 것이고,
-- 안 누르면 그만입니다.
--
-- 로컬에서 1,000만 자를 제출해 봤더니 통과했고 한 건에 28.6MB 가 저장됐습니다. 반복 제한도
-- 없었습니다. 채점 게이트는 AI 요금을 지키지 데이터베이스를 지키지 않습니다.
--
-- 같은 표에 쓰는 다른 경로(`record_answer_attempt`)는 이미 64KiB 로 막고 있었습니다 —
-- `submit_quiz_answer` 만 그 검사를 지나쳤습니다. 한 표에 두 규칙이 있으면 느슨한 쪽이
-- 그 표의 규칙입니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('de000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid uuid := 'de000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_card uuid; v_set uuid;
  v_qe uuid; v_qs uuid; v_run uuid; v_ie uuid; v_is uuid;
  r jsonb;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'len', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"a","field_2":"b","field_3":"c","field_4":"d"}'::jsonb)
    RETURNING id INTO v_card;
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, 'len', 'essay', 'deck', 2, 2, 'ready', 'ko') RETURNING id INTO v_set;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              reference_answer, source_fingerprint, rubric)
    VALUES (v_set, v_uid, v_card, 'essay', 1, '설명하세요', 'b', 'fp1',
            '[{"id":"x","aspect":"covers_answer","weight":100,"mustMention":[]}]'::jsonb)
    RETURNING id INTO v_qe;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              reference_answer, source_fingerprint)
    VALUES (v_set, v_uid, v_card, 'short', 2, '뜻은?', 'b', 'fp2')
    RETURNING id INTO v_qs;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  SELECT i.id INTO v_ie FROM quiz_run_items i WHERE i.run_id = v_run AND i.question_id = v_qe;
  SELECT i.id INTO v_is FROM quiz_run_items i WHERE i.run_id = v_run AND i.question_id = v_qs;

  -- ══ 1. 짧은 서술형 답안은 통과한다 ═══════════════════════════════════════
  --
  -- 하한을 없앤 것과 상한을 건 것은 다른 결정입니다. 여기서 막히면 하한이 살아 있는 것입니다.
  PERFORM public.submit_quiz_answer(v_ie, jsonb_build_object('text', '짧음'));

  -- ══ 2. 상한을 넘는 서술형은 막힌다 — 채점기와 같은 숫자로 ════════════════
  BEGIN
    PERFORM public.submit_quiz_answer(v_is, jsonb_build_object('text', repeat('가', 2001)));
    RAISE EXCEPTION 'FAIL: 2001자 주관식이 통과했다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- 주관식은 300자입니다. 서술형 숫자를 주관식에 쓰면 여기가 통과합니다.
  BEGIN
    PERFORM public.submit_quiz_answer(v_is, jsonb_build_object('text', repeat('가', 301)));
    RAISE EXCEPTION 'FAIL: 301자 주관식이 통과했다 — 유형별 숫자가 안 맞는다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ══ 3. 1,000만 자는 표에 닿지도 못한다 ═══════════════════════════════════
  --
  -- 어뷰징 그대로. 28.6MB 가 저장됐던 경로입니다.
  BEGIN
    PERFORM public.submit_quiz_answer(v_is, jsonb_build_object('text', repeat('가', 10000000)));
    RAISE EXCEPTION 'FAIL: 1,000만 자가 저장됐다';
  EXCEPTION WHEN sqlstate 'P0006' THEN NULL;
       WHEN invalid_parameter_value THEN NULL;
  END;

  -- ══ 4. 표 자체도 막는다 — RPC 를 지나치는 경로가 생겨도 ══════════════════
  BEGIN
    INSERT INTO answer_attempts (user_id, card_id, client_attempt_id, activity_type,
                                 response_type, evaluator_type, response)
      VALUES (v_uid, v_card, gen_random_uuid(), 'recall', 'text', 'ai',
              jsonb_build_object('text', repeat('가', 100000)));
    RAISE EXCEPTION 'FAIL: 표에 직접 쓰면 상한이 없다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 5. 덱 이름·설명, 템플릿 이름 ═════════════════════════════════════════
  BEGIN
    UPDATE decks SET name = repeat('가', 201) WHERE id = v_deck;
    RAISE EXCEPTION 'FAIL: 201자 덱 이름이 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 그리고 평범한 이름은 통과해야 합니다. 프로덕션 최대가 66자입니다.
  UPDATE decks SET name = repeat('가', 66) WHERE id = v_deck;

  RAISE NOTICE 'length_limits_test: all assertions passed';
END $$;

ROLLBACK;
