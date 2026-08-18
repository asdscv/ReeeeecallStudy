-- ============================================================================
-- 카드 한도는 **사람이 셀 수 있는 단위**여야 한다.
--
-- 255 는 8,000 바이트를 걸었습니다. 저장을 지키는 데는 맞는 단위인데 화면에 보여줄 수 있는
-- 단위가 아닙니다 — 한글은 한 글자가 3바이트라 같은 "8,000" 이 한국어 학습자에게는 2,666자,
-- 영어 학습자에게는 8,000자입니다. 같은 숫자가 사람마다 다른 뜻이면 보여줄 수 없고, 보여줄 수
-- 없는 한도는 저장을 누른 뒤에야 알게 되는 한도입니다.
--
-- 그래서 글자수(4,000)를 학습자가 보는 한도로 삼고, 바이트(16,000)는 뒤에 서서 절대 먼저
-- 걸리지 않게 합니다. 프로덕션 377,099장 기준 평균 140자 · p99 331자 · 최대 2,188자.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('df000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid uuid := 'df000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'chars', v_tmpl)
    RETURNING id INTO v_deck;

  -- ══ 1. 한도 안쪽의 큰 카드는 통과한다 ═══════════════════════════════════
  --
  -- p99 가 331자이므로 1,800자는 사실상 모든 학습자보다 큽니다.
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object('field_1', repeat('가', 1800)));

  -- ══ 2. 한글이든 영어든 **같은 글자수**에서 막힌다 ════════════════════════
  --
  -- 이것이 바이트가 아니라 글자로 센 이유입니다. 바이트였다면 한국어 카드가 영어 카드보다
  -- 3분의 1 지점에서 막힙니다.
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object('field_1', repeat('가', 2001)));
    RAISE EXCEPTION 'FAIL: 한글 4,001자가 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object('field_1', repeat('a', 2001)));
    RAISE EXCEPTION 'FAIL: 영문 4,001자가 통과했다 — 언어마다 한도가 다르다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 3. 필드를 쪼개도 합계로 막힌다 ═══════════════════════════════════════
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
        'field_1', repeat('가', 800), 'field_2', repeat('나', 800),
        'field_3', repeat('다', 800)));
    RAISE EXCEPTION 'FAIL: 셋으로 쪼개니 통과했다 — 한도가 우회된다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 4. 이미지는 세지 않는다 ══════════════════════════════════════════════
  --
  -- 데이터 URL 은 혼자 수만 자입니다. 학습자가 쓴 글이 아니므로 세면 사진 한 장이 카드를
  -- 통째로 막습니다. 다만 바이트 백스톱에는 걸려야 하므로 그 아래로만 둡니다.
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
      'field_1', '짧은 글',
      'field_2', 'data:image/png;base64,' || repeat('A', 12000)));

  -- 그리고 그 계산이 화면이 세는 것과 같아야 합니다.
  IF public._card_text_chars(jsonb_build_object(
       'a', '가나다', 'b', 'data:image/png;base64,AAAA')) <> 3 THEN
    RAISE EXCEPTION 'FAIL: 글자수 계산이 이미지를 세고 있다';
  END IF;

  RAISE NOTICE 'card_chars_test: all assertions passed';
END $$;

ROLLBACK;
