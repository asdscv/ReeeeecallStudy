-- ============================================================================
-- 바이트 한도는 글자수 한도 **뒤에** 서 있어야 한다.
--
-- 카드에는 두 한도가 있습니다. 학습자가 보는 것은 글자수(4,000)이고, 바이트(16,000)는 그
-- 뒤에서 저장을 지킵니다. 순서가 중요합니다 — 바이트가 먼저 걸리면 한국어 학습자가 영어
-- 학습자보다 3분의 1 지점에서 막히고, 화면이 보여준 숫자와 실제로 막히는 지점이 달라집니다.
--
-- 텍스트만으로는 바이트가 먼저 걸릴 수 없습니다: 4,000자 × 최악 4바이트 = 16,000 이 정확히
-- 상한입니다. 바이트 한도가 실제로 일하는 경우는 하나뿐이고, 이 파일이 그것을 봅니다 —
-- **이미지 데이터 URL**. 글자수에서는 세지 않으므로(사진 한 장이 카드를 통째로 막으면 안
-- 되니까) 저장 크기를 지킬 사람이 바이트 한도밖에 없습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('dc000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'dc000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'size deck', v_tmpl)
    RETURNING id INTO v_deck;

  -- ══ 1. 평범한 카드 ═══════════════════════════════════════════════════════
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"lend","field_2":"빌려주다","field_3":"lend","field_4":"I lend it"}'::jsonb);

  -- ══ 2. 보통 크기의 이미지는 통과한다 ═════════════════════════════════════
  --
  -- 데이터 URL 은 글자수에서 안 세므로, 여기서 막히면 사진이 있는 카드가 전부 막힙니다.
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
      'field_1', 'lend', 'field_2', 'data:image/png;base64,' || repeat('A', 10000)));

  -- ══ 3. 그런데 무한정은 아니다 — 바이트 한도가 그 자리를 지킨다 ═══════════
  --
  -- 글자수 검사는 이 값을 0자로 셉니다. 그러니 이 카드를 막는 것은 바이트 한도뿐이고,
  -- 그것이 이 한도가 존재하는 이유 전체입니다.
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
        'field_1', 'lend', 'field_2', 'data:image/png;base64,' || repeat('A', 20000)));
    RAISE EXCEPTION 'FAIL: 20KB 짜리 데이터 URL 이 통과했다 — 글자수는 이걸 세지 않는다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 4. 그리고 텍스트로는 바이트가 먼저 걸리지 않는다 ═════════════════════
  --
  -- 이것이 두 한도의 순서입니다. 2,001자 한글은 6,003바이트로 바이트 한도(16,000) 아래인데도
  -- 막혀야 합니다 — 막는 주체가 글자수여야 하고, 그래야 화면이 보여준 숫자가 진실입니다.
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object('field_1', repeat('가', 2001)));
    RAISE EXCEPTION 'FAIL: 2,001자가 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF octet_length(jsonb_build_object('field_1', repeat('가', 2001))::text) > 16000 THEN
    RAISE EXCEPTION 'FAIL: 2,001자 한글이 바이트 한도를 넘는다 — 바이트가 먼저 걸린다';
  END IF;

  RAISE NOTICE 'card_size_test: all assertions passed';
END $$;

ROLLBACK;
