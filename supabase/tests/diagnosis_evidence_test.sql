-- ============================================================================
-- 학습 진단의 증거는 **센 것만** 나가고, **답한 문항만** 센다.
--
-- 이 RPC 가 존재하는 이유: 오답 라벨은 `quiz_questions.meta->'flaws'` 에 있고, 그 테이블은
-- RLS 가 켜져 있으며 authenticated 에 GRANT 가 없습니다(193 §2). 그래서 클라이언트는 학습자
-- 자신의 오답 유형조차 볼 수 없었고, 앱은 3년치 라벨을 쌓아두고 정답률 한 줄만 보여줬습니다.
--
-- 서버가 대신 읽는 순간 새로운 위험이 생깁니다: 아직 안 푼 문제의 정답 라벨이 새면 다시
-- 풀기가 공짜 정답이 됩니다. 그래서 이 파일이 검사하는 것은 두 가지입니다.
--
--   1. 세어서 준다 — 어떤 문항의 라벨인지는 절대 나가지 않는다
--   2. 답한 문항만 센다 — 안 푼 문제는 존재조차 드러나지 않는다
--
-- 그리고 남의 목표는 42501.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d6000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('d6000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'd6000000-0000-4000-8000-000000000001';
  v_other uuid := 'd6000000-0000-4000-8000-000000000002';
  v_tmpl  uuid; v_deck uuid; v_goal uuid; v_ogoal uuid;
  v_card1 uuid; v_card2 uuid;
  v_set   uuid; v_q1 uuid; v_q2 uuid; v_run uuid;
  v_item1 uuid; v_item2 uuid;
  r       jsonb;
  v_txt   text;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'diag deck', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values, tags)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"lend","field_2":"빌려주다","field_3":"lend","field_4":"ex"}'::jsonb,
            ARRAY['계약법'])
    RETURNING id INTO v_card1;
  INSERT INTO cards (deck_id, user_id, template_id, field_values, tags)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"borrow","field_2":"빌리다","field_3":"borrow","field_4":"ex"}'::jsonb,
            ARRAY['계약법'])
    RETURNING id INTO v_card2;

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_uid, 'general', '진단 목표', 20) RETURNING id INTO v_goal;
  INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES (v_goal, v_deck);
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_other, 'general', '남의 목표', 20) RETURNING id INTO v_ogoal;

  -- 두 문항. 하나는 풀고, 하나는 안 풉니다 — 안 푼 쪽이 새는지가 이 파일의 절반입니다.
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, 'diag set', 'mcq', 'deck', 2, 2, 'ready', 'ko')
    RETURNING id INTO v_set;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint, meta)
    VALUES (v_set, v_uid, v_card1, 'mcq', 1, 'lend 의 뜻으로 옳은 것은?',
            ARRAY['빌려주다','빌리다','갚다','임대하다'], 0, '빌려주다', 'fp1',
            -- 실제 모양: `options` 와 나란한 배열이고 정답 자리(index 0)는 null 입니다.
            -- 246 의 이 테스트는 여기에 객체를 심었고, 그래서 프로덕션에서 언제나 비어 있던
            -- 집계를 통과시켰습니다(247).
            jsonb_build_object('flaws', jsonb_build_array(
              null, 'adjacent_sense', 'right_category_wrong_item', 'overgeneral')))
    RETURNING id INTO v_q1;
  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint, meta)
    VALUES (v_set, v_uid, v_card2, 'mcq', 2, 'borrow 의 뜻으로 옳은 것은?',
            ARRAY['빌리다','빌려주다','갚다','맡기다'], 0, '빌리다', 'fp2',
            jsonb_build_object('flaws', jsonb_build_array(
              null, 'opposite', 'unrelated', 'plausible_form')))
    RETURNING id INTO v_q2;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  SELECT i.id INTO v_item1 FROM quiz_run_items i
   WHERE i.run_id = v_run AND i.question_id = v_q1;
  SELECT i.id INTO v_item2 FROM quiz_run_items i
   WHERE i.run_id = v_run AND i.question_id = v_q2;

  -- 문항 1을 **틀립니다**: 정규 index 1 = adjacent_sense 인 보기를 고릅니다.
  PERFORM public.submit_quiz_answer(v_item1, jsonb_build_object(
    'choice', (SELECT k - 1
                 FROM quiz_run_items i, unnest(i.option_order) WITH ORDINALITY AS o(v, k)
                WHERE i.id = v_item1 AND o.v = 1)));
  -- 문항 2는 답하지 않습니다.

  -- 226 은 덱이 정확히 한 목표에 속할 때 goal_id 를 붙입니다. 이 덱이 그렇습니다.
  IF (SELECT goal_id FROM answer_attempts WHERE quiz_run_item_id = v_item1) IS DISTINCT FROM v_goal THEN
    RAISE EXCEPTION 'FAIL: 퀴즈 답에 목표가 안 붙었다 — 진단이 이 답을 못 본다';
  END IF;

  -- ══ 1. 고른 오답의 종류가 세어진다 ═══════════════════════════════════════
  r := public.get_learning_diagnosis_evidence(v_goal, 30);
  IF (r -> 'mcq_flaws' ->> 'adjacent_sense')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL: 고른 오답 라벨이 안 세어졌다 (%)', r -> 'mcq_flaws';
  END IF;

  -- ══ 2. 안 푼 문항의 라벨은 새지 않는다 ═══════════════════════════════════
  --
  -- 문항 2의 라벨은 opposite/unrelated/plausible_form 입니다. 하나라도 결과에 있으면 아직
  -- 안 푼 문제의 정답 정보가 새어 나간 것이고, 다시 풀기가 공짜 정답이 됩니다.
  v_txt := r::text;
  IF v_txt LIKE '%opposite%' OR v_txt LIKE '%unrelated%' OR v_txt LIKE '%plausible_form%' THEN
    RAISE EXCEPTION 'FAIL: 안 푼 문항의 오답 라벨이 새어 나갔다 (%)', r -> 'mcq_flaws';
  END IF;

  -- ══ 3. 문항 단위 정보 자체가 나가지 않는다 ═══════════════════════════════
  --
  -- 개수만 나갑니다. 문항 id, 보기 텍스트, 정답 index 중 어느 하나라도 나가면 이 RPC 는
  -- `quiz_questions` 의 GRANT 부재를 우회하는 구멍이 됩니다.
  IF v_txt LIKE '%' || v_q1::text || '%' OR v_txt LIKE '%' || v_q2::text || '%' THEN
    RAISE EXCEPTION 'FAIL: 문항 id 가 새어 나갔다';
  END IF;
  IF v_txt LIKE '%빌려주다%' OR v_txt LIKE '%correct_index%' THEN
    RAISE EXCEPTION 'FAIL: 보기/정답이 새어 나갔다';
  END IF;

  -- ══ 4. 태그와 덱은 나간다 — 학습자 자기 데이터이고, 행동할 수 있는 사실이다 ══
  IF (r -> 'tags' -> 0 ->> 'tag') IS DISTINCT FROM '계약법' THEN
    RAISE EXCEPTION 'FAIL: 태그별 집계가 없다 (%)', r -> 'tags';
  END IF;
  IF (r ->> 'scored')::int <> 1 OR (r ->> 'known')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: 채점 수가 틀렸다 (scored=%, known=%)', r ->> 'scored', r ->> 'known';
  END IF;

  -- ══ 5. 남의 목표는 볼 수 없다 ════════════════════════════════════════════
  BEGIN
    PERFORM public.get_learning_diagnosis_evidence(v_ogoal, 30);
    RAISE EXCEPTION 'FAIL: 남의 목표 증거를 읽었다';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ══ 6. 창 범위는 검사한다 ════════════════════════════════════════════════
  BEGIN
    PERFORM public.get_learning_diagnosis_evidence(v_goal, 400);
    RAISE EXCEPTION 'FAIL: 400일 창이 허용됐다';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'diagnosis_evidence_test: all assertions passed';
END $$;

-- ══ 7. 값과 무료 한도가 데이터로 존재한다 ═══════════════════════════════════
--
-- 239 의 커널이 이걸 위해 만들어졌습니다: 새 AI 행동은 타입 변경이 아니라 행 하나.
DO $$
DECLARE v_price bigint; v_free integer;
BEGIN
  SELECT price_micro INTO v_price FROM ai_action_prices WHERE action = 'diagnosis';
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'FAIL: diagnosis 값이 없다 — 예약이 0원으로 통과한다';
  END IF;
  -- 사다리 **안**에 있어야 합니다. 246 은 여기서 정확히 반대를 단언했습니다 — "목표 전체를
  -- 보니까 카드 한 장 설명보다 비싸야 한다". 그건 일의 크기로 정한 값이고, 학습자가 보는 것은
  -- 값들의 줄입니다. 나머지 전부가 $0.05~$0.50 인데 하나만 $1.00 이면 "특별하다"가 아니라
  -- "여기 물건이 아니다"로 읽힙니다(248).
  --
  -- 그래서 이 단언은 위아래를 모두 잡습니다: 낱개 행동보다는 비싸고, 사다리 꼭대기를 넘지는
  -- 않는다.
  IF v_price <= (SELECT price_micro FROM ai_action_prices WHERE action = 'card') THEN
    RAISE EXCEPTION 'FAIL: 진단이 카드 한 장 값 이하다 (%)', v_price;
  END IF;
  IF v_price > (SELECT max(price_micro) FROM ai_action_prices WHERE action <> 'diagnosis') THEN
    RAISE EXCEPTION 'FAIL: 진단이 사다리 꼭대기를 넘었다 (% > %)',
      v_price, (SELECT max(price_micro) FROM ai_action_prices WHERE action <> 'diagnosis');
  END IF;

  SELECT per_day INTO v_free FROM ai_free_allowances
   WHERE tier = 'free' AND action_group = 'diagnosis';
  IF v_free IS NULL THEN
    RAISE EXCEPTION 'FAIL: diagnosis 무료 정책 행이 없다 — 정책이 코드에 숨는다';
  END IF;
  RAISE NOTICE 'diagnosis_evidence_test: price % micro, free %/day', v_price, v_free;
END $$;

ROLLBACK;
