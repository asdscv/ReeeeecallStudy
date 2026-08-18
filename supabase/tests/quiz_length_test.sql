-- ============================================================================
-- 퀴즈 길이 상한은 **세트와 회차 양쪽**에 있다.
--
-- 설정 화면이 20·30·50 을 보여 주는 동안 스키마는 12 에서 막고 있었고, 학습자가 20 을 고르면
-- 원시 제약 위반(23514)이 돌아왔습니다. 264 가 20 까지 열었습니다.
--
-- 두 CHECK 를 같이 봅니다. 하나만 열면 세트는 만들어지고 `start_quiz_run` 이 터집니다 —
-- 값을 치른 **뒤에** 터지는 자리라 더 나쁩니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'e0000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_set uuid; v_max integer;
BEGIN
  -- 상한을 **스키마에서 읽습니다.** 손으로 적으면 조정할 때마다 여기서 터집니다.
  SELECT (regexp_match(pg_get_constraintdef(oid), 'requested_count <= (\d+)'))[1]::int
    INTO v_max FROM pg_constraint WHERE conname = 'quiz_sets_requested_count_check';
  IF v_max IS NULL THEN RAISE EXCEPTION 'FAIL: 세트 길이 CHECK 를 못 읽었다'; END IF;

  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '길이 덱', v_tmpl)
    RETURNING id INTO v_deck;

  -- ══ 1. 상한만큼은 만들어진다 ═════════════════════════════════════════════
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, generated_count, status, content_locale)
    VALUES (v_uid, v_deck, '상한', 'mcq', 'deck', v_max, 0, 'ready', 'ko')
    RETURNING id INTO v_set;

  -- ══ 2. 상한 +1 은 거절된다 ═══════════════════════════════════════════════
  BEGIN
    INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                           requested_count, generated_count, status, content_locale)
      VALUES (v_uid, v_deck, '초과', 'mcq', 'deck', v_max + 1, 0, 'ready', 'ko');
    RAISE EXCEPTION 'FAIL: 상한을 넘는 세트가 만들어졌다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 3. 회차도 같은 상한을 받는다 ═════════════════════════════════════════
  --
  -- 세트만 열고 회차를 안 열면, 값을 치르고 문항을 다 만든 다음 풀기를 누를 때 터집니다.
  INSERT INTO quiz_runs (user_id, set_id, attempt_no, item_count, status)
    VALUES (v_uid, v_set, 1, v_max, 'in_progress');

  BEGIN
    INSERT INTO quiz_runs (user_id, set_id, attempt_no, item_count, status)
      VALUES (v_uid, v_set, 2, v_max + 1, 'in_progress');
    RAISE EXCEPTION 'FAIL: 상한을 넘는 회차가 만들어졌다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 4. 두 상한이 같다 ════════════════════════════════════════════════════
  IF v_max <> (SELECT (regexp_match(pg_get_constraintdef(oid), 'item_count <= (\d+)'))[1]::int
                 FROM pg_constraint WHERE conname = 'quiz_runs_item_count_check') THEN
    RAISE EXCEPTION 'FAIL: 세트 상한과 회차 상한이 다르다 — 세트는 만들어지고 회차가 터진다';
  END IF;

  -- ══ 5. 한 번의 호출로 만들 수 있는 유닛 안에 있다 ════════════════════════
  --
  -- 클라이언트가 배치로 쪼개므로(객관식 8 · 서술형 3) 호출당 유닛은 상한보다 훨씬 작습니다.
  -- 그래도 **가장 비싼 유형의 한 배치**가 `quiz_max_units_per_call` 을 넘지 않는지 봅니다 —
  -- 넘으면 20문항짜리가 매 배치 AI_REQUEST_TOO_LARGE 로 실패합니다.
  IF (SELECT 3 * (SELECT units FROM ai_quiz_price_units WHERE action = 'generate_essay'))
     > (SELECT quiz_max_units_per_call FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: 서술형 한 배치가 호출당 유닛 상한을 넘는다';
  END IF;

  RAISE NOTICE 'quiz_length_test: all assertions passed';
END $$;

ROLLBACK;
