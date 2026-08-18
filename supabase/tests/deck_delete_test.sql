-- ============================================================================
-- 공부한 적 있는 덱은 지워져야 한다.
--
-- 두 규칙이 서로를 막고 있었습니다: `answer_attempts.card_id` 는 ON DELETE SET NULL 인데
-- `attempt_target_required` 는 셋 중 하나를 요구합니다. 카드가 유일한 대상이던 시도는
-- 카드가 지워지는 순간 CHECK 를 위반하고, 삭제 전체가 23514 로 롤백됩니다.
--
-- 앱과 같은 경로(REST DELETE /decks)로 프로덕션에서 재현했습니다. 시도 99건 중 70건이
-- 카드만 대상이었고, 시도를 가진 계정 3개가 전부 해당했습니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e2000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'e2000000-0000-4000-8000-000000000001';
  v_tmpl uuid; v_deck uuid; v_card uuid; v_other uuid; v_act uuid;
  v_keep uuid; v_go uuid;
  v_n integer;
BEGIN
  SELECT id INTO v_tmpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '지울 덱', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"a","field_2":"b","field_3":"c","field_4":"d"}'::jsonb)
    RETURNING id INTO v_card;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"e","field_2":"f","field_3":"g","field_4":"h"}'::jsonb)
    RETURNING id INTO v_other;

  -- 카드가 유일한 대상인 시도 — 이것 때문에 덱 삭제가 실패했습니다.
  INSERT INTO answer_attempts (user_id, card_id, client_attempt_id, activity_type,
                               response_type, evaluator_type, normalized_score)
    VALUES (v_uid, v_card, gen_random_uuid(), 'recall', 'self_rate', 'self_rate', 1)
    RETURNING id INTO v_go;

  -- 활동에도 걸린 시도 — 카드가 없어져도 읽히므로 **남아야** 합니다.
  INSERT INTO learning_activities (owner_user_id, title, activity_type, stimulus_type,
                                   response_type, evaluator_type)
    VALUES (v_uid, '활동', 'recall', 'text', 'self_rate', 'self_rate') RETURNING id INTO v_act;
  INSERT INTO answer_attempts (user_id, card_id, activity_id, client_attempt_id, activity_type,
                               response_type, evaluator_type, normalized_score)
    VALUES (v_uid, v_other, v_act, gen_random_uuid(), 'recall', 'self_rate', 'self_rate', 0)
    RETURNING id INTO v_keep;

  -- ══ 1. 덱이 지워진다 ════════════════════════════════════════════════════
  DELETE FROM decks WHERE id = v_deck;

  SELECT count(*) INTO v_n FROM decks WHERE id = v_deck;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 덱이 안 지워졌다'; END IF;

  -- ══ 2. 카드만 대상이던 시도는 카드와 함께 갔다 ═══════════════════════════
  SELECT count(*) INTO v_n FROM answer_attempts WHERE id = v_go;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 가리킬 데 없는 시도가 남았다'; END IF;

  -- ══ 3. 다른 대상이 있던 시도는 남았다 ════════════════════════════════════
  --
  -- 이것까지 지우면 카드 하나 지웠다고 활동 기록이 사라집니다.
  SELECT count(*) INTO v_n FROM answer_attempts WHERE id = v_keep AND card_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 활동에 걸린 시도가 남지 않았거나 card_id 가 안 비워졌다';
  END IF;

  -- ══ 4. 카드 한 장만 지워도 마찬가지다 ════════════════════════════════════
  --
  -- 덱 삭제만 고치면 "카드 지우기"에서 같은 23514 가 그대로 남습니다.
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, '두 번째', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"field_1":"x","field_2":"y","field_3":"z","field_4":"w"}'::jsonb)
    RETURNING id INTO v_card;
  INSERT INTO answer_attempts (user_id, card_id, client_attempt_id, activity_type,
                               response_type, evaluator_type, normalized_score)
    VALUES (v_uid, v_card, gen_random_uuid(), 'recall', 'self_rate', 'self_rate', 1);

  DELETE FROM cards WHERE id = v_card;
  SELECT count(*) INTO v_n FROM cards WHERE id = v_card;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 카드가 안 지워졌다'; END IF;

  RAISE NOTICE 'deck_delete_test: all assertions passed';
END $$;

ROLLBACK;
