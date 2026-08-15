-- Migrations 225 and 226: what the quiz list could not say, and what the planner could not see.
--
-- 225 — the row read `제목 / 객관식 · 10문항` and stopped. When it was made, whether it had ever
-- been taken and how it went were all in the database already. The tally is built from
-- `answer_attempts` at the grader's own 0.75 band, NOT from `quiz_runs.score_raw / score_max` —
-- that is the arithmetic that reported 17% for six answers and one paid grade, and a history
-- using it would contradict the result screen about the same sitting.
--
-- 226 — every insight the learning engine draws reads `answer_attempts` FILTERED BY goal_id, and
-- quiz answers were written with none. 56 attempts on production carrying a card, a response and
-- a score, invisible to the one thing they were worth reading for.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('eb000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'eb000000-0000-4000-8000-000000000001';
  v_deck uuid := gen_random_uuid();
  v_tpl  uuid := gen_random_uuid();
  v_goal uuid := gen_random_uuid();
  v_set  uuid := gen_random_uuid();
  v_run  uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid();
  v_q    uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_t jsonb; v_list jsonb; v_hist jsonb; v_goal_seen uuid;
BEGIN
  INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout)
    VALUES (v_tpl, v_uid, 'hist',
      '[{"key":"f","name":"앞","type":"text"},{"key":"b","name":"뒤","type":"text"}]'::jsonb,
      '[{"field_key":"f","style":"primary"}]'::jsonb,
      '[{"field_key":"b","style":"primary"}]'::jsonb);
  INSERT INTO decks (id, user_id, name) VALUES (v_deck, v_uid, 'history deck');
  INSERT INTO cards (id, deck_id, user_id, template_id, field_values)
    VALUES (v_card, v_deck, v_uid, v_tpl, '{"f":"lend","b":"빌려주다"}'::jsonb);
  INSERT INTO quiz_sets (id, owner_user_id, deck_id, title, question_type, scope_kind,
                         content_locale, requested_count, generated_count)
    VALUES (v_set, v_uid, v_deck, 'history set', 'short', 'deck', 'ko', 3, 3);
  INSERT INTO quiz_questions (id, set_id, owner_user_id, card_id, position, question_type,
                              stem, reference_answer, source_fingerprint)
    VALUES (v_q, v_set, v_uid, v_card, 1, 'short', 'lend', '빌려주다', 'test-fingerprint');
  INSERT INTO quiz_runs (id, set_id, user_id, attempt_no, status, item_count)
    VALUES (v_run, v_set, v_uid, 1, 'in_progress', 3);
  INSERT INTO quiz_run_items (id, run_id, question_id, position, status)
    VALUES (v_item, v_run, v_q, 1, 'graded'),
           (gen_random_uuid(), v_run, v_q, 2, 'answered'),
           (gen_random_uuid(), v_run, v_q, 3, 'pending');

  -- One graded correct, one answered and never judged, one never touched.
  INSERT INTO answer_attempts (user_id, card_id, quiz_run_item_id, client_attempt_id,
                               activity_type, response_type, evaluator_type, response,
                               normalized_score, duration_ms)
    VALUES (v_uid, v_card, v_item, gen_random_uuid(), 'recall', 'text', 'ai',
            '{"text":"빌려주다"}'::jsonb, 1, 100),
           (v_uid, v_card, (SELECT id FROM quiz_run_items WHERE run_id = v_run AND position = 2),
            gen_random_uuid(), 'recall', 'text', 'ai', '{"text":"?"}'::jsonb, NULL, 100);

  v_t := public._quiz_run_tally(v_run);
  ASSERT (v_t->>'total')::int = 3,    format('three items, got %s', v_t->>'total');
  ASSERT (v_t->>'answered')::int = 2, format('two answered, got %s', v_t->>'answered');
  ASSERT (v_t->>'correct')::int = 1,  format('one correct, got %s', v_t->>'correct');
  ASSERT (v_t->>'wrong')::int = 0,    format('none wrong, got %s', v_t->>'wrong');
  -- THE point: an answer nobody paid to judge is not a wrong answer.
  ASSERT (v_t->>'ungraded')::int = 1, format('one ungraded, got %s', v_t->>'ungraded');

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  v_list := list_quiz_sets(50);
  ASSERT jsonb_array_length(v_list) = 1, 'the learner has one set';
  ASSERT (v_list->0->>'run_count')::int = 1, 'one sitting';
  ASSERT (v_list->0->>'created_at') IS NOT NULL, 'the list must carry when it was made';
  ASSERT (v_list->0->'last_tally'->>'correct')::int = 1, 'the last sitting travels with the row';
  ASSERT (v_list->0->>'deck_name') = 'history deck', 'the deck it came from';

  v_hist := get_quiz_set_history(v_set);
  ASSERT jsonb_array_length(v_hist) = 1, 'one run in the history';
  ASSERT (v_hist->0->>'attempt_no')::int = 1, 'attempt 1';
  ASSERT (v_hist->0->'tally'->>'ungraded')::int = 1, 'the history counts the same way';

  RAISE NOTICE 'quiz_set_history_test: 225 assertions passed';
END $$;

-- Somebody else's set is not readable, and not listed.
DO $$
DECLARE v_other uuid := gen_random_uuid(); v_set uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  INSERT INTO auth.users (id) VALUES (v_other) ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_set FROM quiz_sets WHERE title = 'history set';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_other::text, false);

  ASSERT jsonb_array_length(list_quiz_sets(50)) = 0, 'another learner sees no sets of mine';
  BEGIN
    PERFORM get_quiz_set_history(v_set);
    RAISE EXCEPTION 'FAIL: another user read my quiz history';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  RAISE NOTICE 'quiz_set_history_test (scoping): assertions passed';
END $$;

ROLLBACK;
