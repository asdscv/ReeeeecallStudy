-- Migrations 224 and 231: which quiz sets can be removed, and what goes with them.
--
-- 17 of production's 49 sets had zero questions and no way to go: a generation that produces
-- nothing leaves a row that cannot be taken (the button is disabled at generated_count = 0) and
-- could not be cleared.
--
-- 224 refused once a set had been run, because the cascade reaches the learner's own answers:
-- quiz_questions, quiz_runs and quiz_run_items all cascade from a set, and answer_attempts
-- cascades from a run item. 231 lifted that refusal at the owner's request and moved the warning
-- to a confirm the learner reads — an error they cannot get past is not a safeguard, it is a
-- dead end.
--
-- So the assertion inverts: a set with history now DELETES, and the cascade is asserted rather
-- than prevented, because that is the promise the confirm dialog makes on its behalf.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('ea000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'ea000000-0000-4000-8000-000000000001';
  v_other uuid := 'ea000000-0000-4000-8000-000000000002';
  v_deck  uuid := gen_random_uuid();
  v_empty uuid := gen_random_uuid();
  v_taken uuid := gen_random_uuid();
  v_theirs uuid := gen_random_uuid();
  v_ok boolean; v_n integer;
BEGIN
  INSERT INTO decks (id, user_id, name) VALUES (v_deck, v_uid, 'delete test');
  INSERT INTO quiz_sets (id, owner_user_id, deck_id, title, question_type, scope_kind,
                         content_locale, requested_count, generated_count)
    VALUES (v_empty,  v_uid,   v_deck, 'generated nothing', 'mcq', 'deck', 'ko', 4, 0),
           (v_taken,  v_uid,   v_deck, 'has been sat',      'mcq', 'deck', 'ko', 4, 4),
           (v_theirs, v_other, v_deck, 'not mine',          'mcq', 'deck', 'ko', 4, 0);
  INSERT INTO quiz_runs (set_id, user_id, attempt_no, status, item_count)
    VALUES (v_taken, v_uid, 1, 'completed', 4);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- The whole point: the dead row goes.
  v_ok := delete_quiz_set(v_empty);
  ASSERT v_ok, 'an unrun set should delete';
  SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_empty;
  ASSERT v_n = 0, 'the row should be gone';

  -- A set with a run deletes now (231), and the sittings go with it. This is asserted, not
  -- merely allowed: the confirm dialog tells the learner their answers go, and that promise is
  -- only true if the cascade actually runs.
  v_ok := delete_quiz_set(v_taken);
  ASSERT v_ok, 'a taken set should delete since 231';
  SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_taken;
  ASSERT v_n = 0, 'the set is gone';
  SELECT count(*) INTO v_n FROM quiz_runs WHERE set_id = v_taken;
  ASSERT v_n = 0, 'its sittings went with it';

  -- Somebody else's, even though theirs is empty too.
  BEGIN
    PERFORM delete_quiz_set(v_theirs);
    RAISE EXCEPTION 'FAIL: another user''s set was deleted';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  SELECT count(*) INTO v_n FROM quiz_sets WHERE id = v_theirs;
  ASSERT v_n = 1, 'another user''s set must survive';

  -- Already gone is what the caller wanted, not an error a screen has to special-case on a
  -- double tap.
  v_ok := delete_quiz_set(v_empty);
  ASSERT NOT v_ok, 'deleting a missing set should report false, not raise';

  RAISE NOTICE 'quiz_set_delete_test: all assertions passed';
END $$;

ROLLBACK;
