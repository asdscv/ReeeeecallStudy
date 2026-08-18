-- ============================================================================
-- 서술형 모범답안은 **답한 뒤에만** 보인다.
--
-- 262 가 문항을 만들 때 모범답안도 같이 씁니다(252 가 객관식 해설에 한 것과 같은 이유).
-- 그런데 답하기 전에 보이면 그건 문항이 아니라 정답지입니다 — `rubric` 과 `reference_answer`
-- 가 이미 같은 규칙 아래 있고, 모범답안은 그 둘보다 더 직접적인 정답입니다.
--
-- 그리고 NULL 이 정상입니다. 모델이 못 쓰면 그 필드만 비고 문항은 그대로 나가야 합니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('de000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'de000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_card uuid; v_set uuid;
  v_run  uuid; v_item uuid;
  r      jsonb; v_items jsonb; v_first jsonb;
  v_n    integer;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '모범답안 덱', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"photosynthesis","field_2":"광합성","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, '모범답안 세트', 'essay', 'deck', 1, 0, 'ready', 'ko')
    RETURNING id INTO v_set;

  -- ══ 1. 저장 경로가 model_answer 를 받는다 ════════════════════════════════
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.persist_quiz_questions(v_set, jsonb_build_array(jsonb_build_object(
    'card_id', v_card, 'stem', 'photosynthesis 를 설명하세요.',
    'reference_answer', '광합성',
    'rubric', jsonb_build_array(jsonb_build_object('id','c0','aspect','covers_answer','weight',100)),
    'model_answer', '광합성은 빛 에너지를 화학 에너지로 바꾸는 과정입니다.',
    'source_fingerprint', 'fp')));

  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = v_set AND model_answer IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: 모범답안이 저장되지 않았다'; END IF;

  -- ══ 2. 답하기 전에는 안 보인다 ═══════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;

  v_items := public.get_quiz_run_items(v_run) -> 'items';
  v_first := v_items -> 0;
  IF v_first ? 'model_answer' AND jsonb_typeof(v_first -> 'model_answer') <> 'null' THEN
    RAISE EXCEPTION 'FAIL: 답하기 전에 모범답안이 보인다 — 그건 정답지다 (%)', v_first -> 'model_answer';
  END IF;
  -- 같은 규칙 아래 있는 둘도 함께 확인합니다.
  IF jsonb_typeof(v_first -> 'reference_answer') <> 'null'
     OR jsonb_typeof(v_first -> 'rubric') <> 'null' THEN
    RAISE EXCEPTION 'FAIL: 답 전에 정답/루브릭이 새어 나온다';
  END IF;

  -- ══ 3. 답한 뒤에는 보인다 ════════════════════════════════════════════════
  v_item := (v_first ->> 'item_id')::uuid;
  PERFORM public.submit_quiz_answer(v_item, jsonb_build_object('text', '빛으로 양분을 만드는 것'));

  v_first := public.get_quiz_run_items(v_run) -> 'items' -> 0;
  IF v_first ->> 'model_answer' IS NULL THEN
    RAISE EXCEPTION 'FAIL: 답한 뒤에도 모범답안이 안 온다 — 만들고 값까지 받은 것을 안 보여 준다';
  END IF;
  IF v_first ->> 'model_answer' <> '광합성은 빛 에너지를 화학 에너지로 바꾸는 과정입니다.' THEN
    RAISE EXCEPTION 'FAIL: 다른 글이 왔다 (%)', v_first ->> 'model_answer';
  END IF;

  -- ══ 4. 모범답안이 없어도 문항은 산다 ═════════════════════════════════════
  --
  -- 모델이 못 쓸 수 있고, 262 이전 문항에는 아예 없습니다. 그때 문항이 안 열리면 안 됩니다.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.persist_quiz_questions(v_set, jsonb_build_array(jsonb_build_object(
    'card_id', v_card, 'stem', '모범답안 없는 문항',
    'reference_answer', '광합성',
    'rubric', jsonb_build_array(jsonb_build_object('id','c0','aspect','covers_answer','weight',100)),
    'source_fingerprint', 'fp2')));
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = v_set;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL: 모범답안 없는 문항이 저장되지 않았다'; END IF;

  -- ══ 5. 길이 상한 ═════════════════════════════════════════════════════════
  --
  -- 출력 예산에서 나온 숫자입니다. 상한이 없으면 한 호출이 3문항 x 무한대를 쓰고, 잘린 JSON은
  -- 파싱에 실패해 문항이 통째로 안 나옵니다.
  BEGIN
    UPDATE quiz_questions SET model_answer = repeat('가', 601)
     WHERE set_id = v_set AND stem = '모범답안 없는 문항';
    RAISE EXCEPTION 'FAIL: 601자 모범답안이 저장됐다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'model_answer_test: all assertions passed';
END $$;

ROLLBACK;
