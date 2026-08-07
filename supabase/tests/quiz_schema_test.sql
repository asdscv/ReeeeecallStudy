-- Quiz schema (migration 193) — the guarantees the tables themselves must make.
--
-- The load-bearing one is the first: a learner must not be able to read the answer key of a
-- question they are about to be asked. `learning_activities` was rejected for quiz precisely
-- because it grants SELECT to `authenticated` and exposes NULL-owner rows to everyone, so the
-- replacement has to be checked rather than assumed. Privileges are tested with SET ROLE,
-- not with JWT claims: a claim moves RLS, and RLS is not what is protecting these tables.
--
-- Everything else here pins a CHECK that encodes a decision — the mcq/non-mcq column shape, the
-- one-populated-scope rule, the option permutation — plus the orphan trigger and the 189 hole.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_owner uuid := 'c1000000-0000-4000-8000-000000000001';
  v_other uuid := 'c2000000-0000-4000-8000-000000000002';
  v_tmpl  uuid;
  v_deck  uuid;
  v_card  uuid;
  v_set   uuid;
  v_q     uuid;
  v_run   uuid;
  v_item  uuid;
  v_n     integer;
  v_status text;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout)
    VALUES (v_owner, 'QT',
            '[{"key":"f","name":"F","type":"text","order":0},
              {"key":"b","name":"B","type":"text","order":1}]'::jsonb,
            '[{"field_key":"f","style":"primary"}]'::jsonb,
            '[{"field_key":"b","style":"primary"}]'::jsonb)
    RETURNING id INTO v_tmpl;
  INSERT INTO decks (user_id, name, default_template_id)
    VALUES (v_owner, 'QD', v_tmpl) RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_owner, v_tmpl, '{"f":"prompt","b":"answer"}'::jsonb)
    RETURNING id INTO v_card;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, content_locale)
    VALUES (v_owner, v_deck, 'S', 'mcq', 'deck', 4, 'en') RETURNING id INTO v_set;

  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              options, correct_index, reference_answer, source_fingerprint)
    VALUES (v_set, v_owner, v_card, 'mcq', 0, 'What?',
            ARRAY['answer','x','y','z'], 0, 'answer', 'fp1') RETURNING id INTO v_q;

  INSERT INTO quiz_runs (set_id, user_id, attempt_no, item_count)
    VALUES (v_set, v_owner, 1, 1) RETURNING id INTO v_run;
  INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
    VALUES (v_run, v_q, 0, ARRAY[2,0,3,1]::smallint[]) RETURNING id INTO v_item;

  -- ── 1) The answer key is unreadable by a learner ───────────────────────────
  -- Not "filtered to their own rows" — unreadable. There is no GRANT, so the attempt fails
  -- before any policy is consulted. This is the single check that justifies not reusing
  -- learning_activities.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM quiz_questions LIMIT 1;
    RAISE EXCEPTION 'FAIL: authenticated could SELECT quiz_questions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM 1 FROM quiz_run_items LIMIT 1;
    RAISE EXCEPTION 'FAIL: authenticated could SELECT quiz_run_items (holds option_order)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ── 2) Sets and runs are readable, but only your own ───────────────────────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM quiz_sets;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: another user saw % quiz_sets', v_n; END IF;
  SELECT count(*) INTO v_n FROM quiz_runs;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: another user saw % quiz_runs', v_n; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM quiz_sets;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: owner saw % of their own quiz_sets, expected 1', v_n; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ── 3) The mcq / non-mcq column shape ──────────────────────────────────────
  -- An mcq without choices is unrenderable; a short answer WITH a correct_index would be
  -- graded by index compare instead of by meaning, which is the wrong evaluator entirely.
  BEGIN
    INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                                reference_answer, source_fingerprint)
      VALUES (v_set, v_owner, v_card, 'mcq', 1, 'no options', 'answer', 'fp2');
    RAISE EXCEPTION 'FAIL: mcq accepted without options/correct_index';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                                options, correct_index, reference_answer, source_fingerprint)
      VALUES (v_set, v_owner, v_card, 'short', 2, 'q', ARRAY['a','b','c','d'], 0, 'answer', 'fp3');
    RAISE EXCEPTION 'FAIL: short answer accepted with options/correct_index';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                                options, correct_index, reference_answer, source_fingerprint)
      VALUES (v_set, v_owner, v_card, 'mcq', 3, 'q', ARRAY['a','b','c'], 0, 'answer', 'fp4');
    RAISE EXCEPTION 'FAIL: mcq accepted with 3 options';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Essay and short are accepted with neither — but an essay must carry its rubric.
  -- Without one the grader would be handed an open request to judge prose, which is the
  -- one thing this design never asks a model to do.
  BEGIN
    INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                                reference_answer, source_fingerprint)
      VALUES (v_set, v_owner, v_card, 'essay', 4, 'Explain.', 'answer', 'fp5');
    RAISE EXCEPTION 'FAIL: essay accepted with no rubric';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                                reference_answer, rubric, source_fingerprint)
      VALUES (v_set, v_owner, v_card, 'essay', 5, 'Explain.', 'answer', '[]'::jsonb, 'fp6');
    RAISE EXCEPTION 'FAIL: essay accepted with an empty rubric';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              reference_answer, rubric, source_fingerprint)
    VALUES (v_set, v_owner, v_card, 'essay', 4, 'Explain.', 'answer',
            '[{"id":"c1","aspect":"accuracy","weight":100,"mustMention":["answer"]}]'::jsonb, 'fp5');

  INSERT INTO quiz_questions (set_id, owner_user_id, card_id, question_type, position, stem,
                              reference_answer, source_fingerprint)
    VALUES (v_set, v_owner, v_card, 'short', 6, 'What?', 'answer', 'fp7');

  -- ── 4) Exactly one scope shape is populated ────────────────────────────────
  BEGIN
    INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                           scope_card_ids, requested_count, content_locale)
      VALUES (v_owner, v_deck, 'bad', 'mcq', 'deck', ARRAY[v_card], 4, 'en');
    RAISE EXCEPTION 'FAIL: deck scope accepted while carrying card ids';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                           requested_count, content_locale)
      VALUES (v_owner, v_deck, 'bad', 'mcq', 'tags', 4, 'en');
    RAISE EXCEPTION 'FAIL: tag scope accepted with no tags';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 5) option_order is a permutation of 0..3, not any four numbers ─────────
  -- A duplicate would render the same choice twice and make one option unreachable.
  BEGIN
    INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
      VALUES (v_run, v_q, 1, ARRAY[0,0,1,2]::smallint[]);
    RAISE EXCEPTION 'FAIL: option_order accepted a duplicate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
      VALUES (v_run, v_q, 2, ARRAY[0,1,2,4]::smallint[]);
    RAISE EXCEPTION 'FAIL: option_order accepted an out-of-range index';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 6) A quiz answer is an attempt ─────────────────────────────────────────
  -- The widened target CHECK must accept a row whose only target is a quiz item.
  INSERT INTO answer_attempts (user_id, card_id, quiz_run_item_id, activity_type, response_type,
                               evaluator_type, response, normalized_score, client_attempt_id)
    VALUES (v_owner, v_card, v_item, 'recall', 'choice', 'choice',
            '{"choice":0}'::jsonb, 1.0, gen_random_uuid());

  -- ...and only one per presented item, so a double submit cannot be graded (and charged) twice.
  BEGIN
    INSERT INTO answer_attempts (user_id, card_id, quiz_run_item_id, activity_type, response_type,
                                 evaluator_type, response, client_attempt_id)
      VALUES (v_owner, v_card, v_item, 'recall', 'choice', 'choice',
              '{"choice":1}'::jsonb, gen_random_uuid());
    RAISE EXCEPTION 'FAIL: a second attempt was accepted for the same run item';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── 7) Deleting the source card voids the presented item ───────────────────
  -- The item keeps its row (the run is a record of what happened) but must not be left at
  -- 'pending' with a NULL question, which no screen can draw.
  DELETE FROM cards WHERE id = v_card;

  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = v_set;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: % questions survived their card', v_n; END IF;

  SELECT status INTO v_status FROM quiz_run_items WHERE id = v_item;
  IF v_status IS DISTINCT FROM 'void' THEN
    RAISE EXCEPTION 'FAIL: orphaned run item is %, expected void', v_status;
  END IF;

  RAISE NOTICE 'quiz_schema_test: all assertions passed';
END;
$$;

ROLLBACK;
