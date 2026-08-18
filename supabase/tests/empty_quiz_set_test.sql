-- ============================================================================
-- 문항이 하나도 안 만들어진 퀴즈 세트는 남아 있으면 안 된다.
--
-- `create_quiz_set` 은 생성 **전에** 세트 행을 씁니다. 그래서 생성이 아무것도 못 만들면 이런
-- 것이 남았습니다:
--
--       essay  요청 1  생성 0  실제문항 0  status = 'ready'
--
-- 프로덕션에 두 개 있었습니다. 목록에는 학습자가 **요청한** 문항 수로 보이고("서술형 1문항"),
-- 풀기를 누르면 빈 회차가 열립니다. 청구된 것은 없으니 남겨 둘 산출물도 없습니다.
--
-- 클라이언트가 실패 시 `delete_quiz_set` 을 부르도록 고쳤고, 이 파일은 그 함수가 **실제로**
-- 빈 세트를 지우는지와 이미 푼 세트는 지우지 않는지를 봅니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('db000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('db000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'db000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_card uuid;
  v_empty uuid; v_used uuid; v_q uuid; v_run uuid; v_item uuid;
  v_n    integer;
  r      jsonb;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'empty set deck', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"lend","field_2":"빌려주다","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ══ 1. 생성이 아무것도 못 만든 세트 — 학습자가 본 그 모양 ════════════════
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, '빈 세트', 'essay', 'deck', 1, 0, 'ready', 'ko')
    RETURNING id INTO v_empty;

  PERFORM public.delete_quiz_set(v_empty);
  SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_empty;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: 빈 세트가 남았다 — 목록에 "1문항"으로 보이고 풀면 빈 회차가 열린다';
  END IF;

  -- ══ 2. 남의 세트는 못 지운다 ═════════════════════════════════════════════
  --
  -- 실패 경로에서 부르는 함수라 id 를 바꿔 부르기 쉬운 자리입니다.
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES ('db000000-0000-4000-8000-000000000002', v_deck, '남의 것', 'mcq', 'deck',
            1, 0, 'ready', 'ko')
    RETURNING id INTO v_used;
  BEGIN
    PERFORM public.delete_quiz_set(v_used);
    -- 지워졌으면 실패입니다. 함수가 소유를 안 보는 것이므로.
    SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_used;
    IF v_n = 0 THEN RAISE EXCEPTION 'FAIL: 남의 세트를 지웠다'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ══ 3. 이미 푼 세트는 문항과 회차까지 함께, 그리고 실패하지 않는다 ═══════
  --
  -- 231/237 이 이 순서를 고쳤습니다(이미 푼 퀴즈 삭제가 23503 으로 실패했습니다). 실패 정리가
  -- 이 경로를 다시 밟으므로 여기서도 확인합니다.
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, '푼 세트', 'mcq', 'deck', 1, 1, 'ready', 'ko')
    RETURNING id INTO v_used;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_used, v_uid, v_card, 'mcq', 1, 'lend?',
            ARRAY['빌려주다','빌리다','갚다','임대하다'], 0, '빌려주다', 'fp')
    RETURNING id INTO v_q;
  r := public.start_quiz_run(v_used);
  v_run := (r->>'run_id')::uuid;
  SELECT i.id INTO v_item FROM quiz_run_items i WHERE i.run_id = v_run LIMIT 1;
  PERFORM public.submit_quiz_answer(v_item, jsonb_build_object('choice', 0));

  PERFORM public.delete_quiz_set(v_used);
  SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_used;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 푼 세트가 안 지워졌다'; END IF;
  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = v_used;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 문항이 남았다'; END IF;

  RAISE NOTICE 'empty_quiz_set_test: all assertions passed';
END $$;

ROLLBACK;
