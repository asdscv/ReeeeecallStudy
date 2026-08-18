-- ============================================================================
-- 카드 한 장의 전체 텍스트에 상한이 있어야 한다.
--
-- 카드는 프롬프트에 통째로 들어갑니다. 생성 한 번에 최대 열 장이니, 카드 크기가 곧 입력
-- 토큰이고 곧 원가입니다. 값은 문항당 고정이라 그 비용은 전부 우리 쪽입니다.
--
-- 한도는 카드 **전체**에 겁니다. 필드별로 걸면 필드를 늘려 우회되고, 앞/뒷면으로 나누면 어느
-- 필드가 어느 면인지를 템플릿 레이아웃이 정하므로 템플릿 편집만으로 한도를 넘나듭니다.
--
-- 프로덕션 377,099장 기준 평균 264B · p99 542B · 최대 3,132B · 4KB 초과 0장이라, 8,000 은
-- 오늘 아무도 걸리지 않는 숫자입니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('dc000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'dc000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid;
  v_big  text;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tmpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'size deck', v_tmpl)
    RETURNING id INTO v_deck;

  -- ══ 1. 평범한 카드는 통과한다 ════════════════════════════════════════════
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl,
            '{"field_1":"lend","field_2":"빌려주다","field_3":"lend","field_4":"I lend it"}'::jsonb);

  -- ══ 2. 현존 최대(3,132B)보다 큰 카드도 통과한다 ══════════════════════════
  --
  -- 한도는 사람을 막으려는 게 아닙니다. 실제로 있는 가장 큰 카드보다 두 배 넘게 여유가
  -- 있어야 합니다 — 아니면 오늘 멀쩡한 학습자가 내일 막힙니다.
  v_big := repeat('가', 2000);
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object('field_1', 'x', 'field_2', v_big));

  -- ══ 3. 병적인 붙여넣기는 막는다 ══════════════════════════════════════════
  --
  -- 8,000 바이트 초과. 한글은 한 글자 3바이트라 4,000자면 12,000 바이트입니다.
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl,
              jsonb_build_object('field_1', 'x', 'field_2', repeat('가', 4000)));
    RAISE EXCEPTION 'FAIL: 12KB 짜리 카드가 통과했다 — 생성 한 번에 그 열 장이 프롬프트로 간다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 4. 필드를 나눠도 합계로 막힌다 ═══════════════════════════════════════
  --
  -- 이 단언이 "필드별이 아니라 카드 전체"라는 결정 그 자체입니다. 필드별 한도였다면 여기가
  -- 통과하고, 그게 곧 우회로입니다.
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tmpl, jsonb_build_object(
        'field_1', repeat('가', 1000), 'field_2', repeat('나', 1000),
        'field_3', repeat('다', 1000), 'field_4', repeat('라', 1000)));
    RAISE EXCEPTION 'FAIL: 필드를 넷으로 쪼개니 통과했다 — 한도가 우회된다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'card_size_test: all assertions passed';
END $$;

ROLLBACK;
