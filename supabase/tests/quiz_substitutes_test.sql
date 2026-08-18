-- ============================================================================
-- 문항을 못 만든 카드 대신 쓸 카드는 **같은 적격성 규칙**에서 나와야 한다.
--
-- 요청한 수만큼 나오는 것이 정상입니다. 어떤 카드는 그 유형에 정말 안 맞으므로(한 단어짜리
-- 카드로 서술형 루브릭을 세울 수 없습니다), 보장은 카드를 **바꾸는** 데서 옵니다.
--
-- 규칙을 새로 쓰지 않는 것이 이 함수의 전부입니다. 엣지에서 `cards` 를 직접 골라 오면
-- 적격성의 두 번째 사본이 생기고, 둘이 갈라지는 날 "견적에는 세어졌는데 생성에는 안 뽑히는
-- 카드"가 나옵니다 — 221 이 고쳤던 실패입니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e1000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'e1000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_set uuid; v_used uuid;
  v_n integer; v_ids uuid[];
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '대체 덱', v_tmpl)
    RETURNING id INTO v_deck;
  FOR v_n IN 1..6 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
        'field_1', 'word' || v_n, 'field_2', '뜻' || v_n, 'field_3', 'p', 'field_4', 'e'));
  END LOOP;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, '대체 세트', 'mcq', 'deck', 3, 0, 'ready', 'ko')
    RETURNING id INTO v_set;

  -- ══ 1. service_role 만 부를 수 있다 ══════════════════════════════════════
  --
  -- 학습자가 부를 수 있으면 남의 세트 id 로 그 덱에 무슨 카드가 있는지 훑는 통로가 됩니다.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  BEGIN
    PERFORM * FROM public.quiz_substitute_cards(v_set, '{}'::uuid[], 3);
    RAISE EXCEPTION 'FAIL: 학습자 권한으로 대체 카드를 읽었다';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ══ 2. 적격 카드를 돌려준다 ══════════════════════════════════════════════
  SELECT count(*), array_agg(card_id) INTO v_n, v_ids
    FROM public.quiz_substitute_cards(v_set, '{}'::uuid[], 3);
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL: 대체 카드 3장을 못 받았다 (%)', v_n; END IF;

  -- ══ 3. 이미 쓴 카드는 후보가 아니다 ══════════════════════════════════════
  --
  -- 같은 카드로 두 문항을 만들면 학습자는 같은 것을 두 번 풉니다.
  SELECT card_id INTO v_used FROM public.quiz_substitute_cards(v_set, '{}'::uuid[], 1);
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_set, v_uid, v_used, 'mcq', 0, 'q', ARRAY['a','b','c','d'], 0, 'a', 'fp');

  SELECT count(*) INTO v_n FROM public.quiz_substitute_cards(v_set, '{}'::uuid[], 10)
   WHERE card_id = v_used;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 이미 문항이 있는 카드가 후보로 나왔다'; END IF;

  -- ══ 4. 제외 목록을 지킨다 ════════════════════════════════════════════════
  --
  -- 지금 배치에서 이미 시도한 카드입니다. 아직 저장 전이라 3번 검사로는 안 걸립니다.
  SELECT array_agg(card_id) INTO v_ids FROM public.quiz_substitute_cards(v_set, '{}'::uuid[], 10);
  SELECT count(*) INTO v_n FROM public.quiz_substitute_cards(v_set, v_ids, 10);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 제외한 카드가 다시 나왔다 (%)', v_n; END IF;

  -- ══ 5. 남은 카드가 없으면 빈 결과 — 예외가 아니다 ════════════════════════
  --
  -- 엣지는 이걸 "정직하게 모자란 채로 끝낸다"로 읽습니다. 예외면 이미 만든 문항까지 잃습니다.
  IF (SELECT count(*) FROM public.quiz_substitute_cards(v_set, v_ids, 10)) <> 0 THEN
    RAISE EXCEPTION 'FAIL: 빈 결과가 아니다';
  END IF;

  -- ══ 6. 남의 세트로는 못 훑는다 ═══════════════════════════════════════════
  --
  -- service_role 이라도 세트가 없으면 거절해야 합니다.
  BEGIN
    PERFORM * FROM public.quiz_substitute_cards(
      '00000000-0000-4000-8000-0000000000ff'::uuid, '{}'::uuid[], 3);
    RAISE EXCEPTION 'FAIL: 없는 세트로 카드를 받았다';
  EXCEPTION WHEN sqlstate 'P0003' THEN NULL;
  END;

  RAISE NOTICE 'quiz_substitutes_test: all assertions passed';
END $$;

ROLLBACK;
