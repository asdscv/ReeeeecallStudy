-- Migration 221: which back field a quiz grades, in the order the answer is decided.
--
-- The bug this pins was silent and only fired on incomplete cards. `_quiz_eligible_cards` picked
-- the graded field by aggregating what each CARD had filled in, so a blank answer left a
-- neighbour standing and the neighbour became the answer. On the 영작 오답노트 shape — back
-- [틀린 표현 primary, 올바른 표현 primary] — that grades the learner against their own mistake.
--
-- Four rules, in this order:
--   1) one declared primary          the author's mark, and a blank one refuses
--   2) no primary, one text field    the answer by elimination
--   3) `quiz_answer_key`             219's stored choice, terminal like (1)
--   4) what the card HAS             last resort, and the reason 착 붙는 중국어 still works
--
-- (4) is deliberately kept: dropping it cost that deck all 429 cards on production, because its
-- back declares a second primary that is empty on every card — an unused field, not an ambiguity.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e9000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'e9000000-0000-4000-8000-000000000001';
  v_deck uuid := gen_random_uuid();
  v_tpl  uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid();
  v_key  text;
  v_n    integer;

  -- back [틀린 표현 primary, 올바른 표현 primary, 설명 secondary] — ambiguous by declaration.
  c_fields constant jsonb := '[{"key":"front","name":"한국어","type":"text"},
                               {"key":"wrong","name":"틀린 표현","type":"text"},
                               {"key":"correct","name":"올바른 표현","type":"text"},
                               {"key":"note","name":"설명","type":"text"}]'::jsonb;
  c_front  constant jsonb := '[{"field_key":"front","style":"primary"}]'::jsonb;
  c_two    constant jsonb := '[{"field_key":"wrong","style":"primary"},
                               {"field_key":"correct","style":"primary"},
                               {"field_key":"note","style":"secondary"}]'::jsonb;
  -- back [올바른 표현 primary, 설명 hint] — one declared answer.
  c_one    constant jsonb := '[{"field_key":"correct","style":"primary"},
                               {"field_key":"note","style":"hint"}]'::jsonb;
BEGIN
  INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout)
    VALUES (v_tpl, v_uid, 'precedence', c_fields, c_front, c_two);
  INSERT INTO decks (id, user_id, name) VALUES (v_deck, v_uid, 'precedence deck');
  INSERT INTO cards (id, deck_id, user_id, template_id, field_values) VALUES (
    v_card, v_deck, v_uid, v_tpl,
    '{"front":"나는 어제 학교에 갔다","wrong":"I go to school yesterday",
      "correct":"I went to school yesterday","note":"과거형"}'::jsonb);

  -- Two declared primaries, both present, nothing stored: still refused. Layout order is not a
  -- declaration, and on this template guessing by it grades against the learner's own mistake.
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_n = 0, format('two primaries should refuse, got %s eligible', v_n);

  -- (3) the stored key resolves it, and it resolves it to the field a positional guess would miss.
  UPDATE card_templates SET quiz_answer_key = 'correct' WHERE id = v_tpl;
  SELECT answer_key INTO v_key FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_key = 'correct', format('stored key should decide, got %s', v_key);

  -- Terminal: the stored field is blank on this card, so there is nothing to grade. It must NOT
  -- fall through to 틀린 표현 — that is the whole bug, and it only ever showed up here.
  UPDATE cards SET field_values = field_values || '{"correct":"   "}'::jsonb WHERE id = v_card;
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_n = 0, format('a blank stored answer must refuse, not demote; got %s eligible', v_n);
  UPDATE cards SET field_values = field_values || '{"correct":"I went to school yesterday"}'::jsonb
   WHERE id = v_card;

  -- (1) an unambiguous declaration outranks the stored key: the author said, and a model's
  -- reading of their labels must not overrule their own mark.
  UPDATE card_templates SET back_layout = c_one WHERE id = v_tpl;   -- quiz_answer_key stays 'correct'
  UPDATE card_templates SET quiz_answer_key = 'note' WHERE id = v_tpl;
  SELECT answer_key INTO v_key FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_key = 'correct', format('a single declared primary should win, got %s', v_key);

  -- ...and a blank primary refuses rather than promoting the hint beside it. This is the second
  -- shape of the same bug: back [뜻 primary, 발음 hint] used to grade against the pronunciation.
  UPDATE cards SET field_values = field_values || '{"correct":""}'::jsonb WHERE id = v_card;
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_n = 0, format('a blank primary must not promote the hint; got %s eligible', v_n);
  UPDATE cards SET field_values = field_values || '{"correct":"I went to school yesterday"}'::jsonb
   WHERE id = v_card;

  -- (4) ambiguous, unresolved, and only one of the two primaries filled in. That is 착 붙는
  -- 중국어: a declared field the author never used. Presence resolves it, and must keep doing so.
  UPDATE card_templates SET back_layout = c_two, quiz_answer_key = NULL WHERE id = v_tpl;
  UPDATE cards SET field_values = field_values || '{"wrong":""}'::jsonb WHERE id = v_card;
  SELECT answer_key INTO v_key FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_key = 'correct', format('an unused second primary is not ambiguity, got %s', v_key);

  -- The three refusals that have not changed: nothing to ask, nothing to grade, answer on show.
  UPDATE card_templates SET front_layout = '[{"field_key":"correct","style":"primary"},
                                             {"field_key":"front","style":"hint"}]'::jsonb,
                            back_layout  = c_one, quiz_answer_key = NULL WHERE id = v_tpl;
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_n = 0, format('an answer shown on the front must refuse, got %s', v_n);

  UPDATE card_templates SET front_layout = c_front WHERE id = v_tpl;
  UPDATE cards SET field_values = '{"correct":"x"}'::jsonb WHERE id = v_card;
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, v_deck);
  ASSERT v_n = 0, format('nothing to ask must refuse, got %s', v_n);

  RAISE NOTICE 'quiz_answer_key_precedence_test: all assertions passed';
END $$;

ROLLBACK;
