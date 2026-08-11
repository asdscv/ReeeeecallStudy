-- Migration 208: a run can grow while it is being answered.
--
-- The dangerous part is the DENOMINATOR. `score_max` is what the learner's percentage is
-- divided by, and it is shown to them mid-run. If it moves independently of the questions
-- they can actually answer, a learner who has answered everything in front of them sees
-- their score fall as the rest of the quiz is written — punished for being fast.
--
-- So: both counters move together, a question is never added twice, and a finished sitting
-- is never touched, because its score is a fact the learner has already been shown.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('f1100000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Prog template');
INSERT INTO decks (id, user_id, name) VALUES
  ('f1200000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Prog deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, created_at)
SELECT ('f1300000-0000-4000-8000-00000000000' || i)::uuid,
       'f1200000-0000-4000-8000-000000000001',
       'f1000000-0000-4000-8000-000000000001',
       'f1100000-0000-4000-8000-000000000001', i, now()
  FROM generate_series(1, 6) i;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_set   uuid;
  v_run   uuid;
  r       jsonb;
  v_row   quiz_runs%ROWTYPE;
  v_items jsonb;
  v_item  uuid;
  i       integer;
BEGIN
  -- A set that will be written in two batches, like a long quiz.
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, content_locale, difficulty, generated_count)
    VALUES ('f1000000-0000-4000-8000-000000000001',
            'f1200000-0000-4000-8000-000000000001',
            'Progressive', 'mcq', 'deck', 6, 'ko', 3, 0)
    RETURNING id INTO v_set;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  -- Batch 1: three questions.
  FOR i IN 1..3 LOOP
    PERFORM persist_quiz_questions(v_set, jsonb_build_array(jsonb_build_object(
      'card_id', ('f1300000-0000-4000-8000-00000000000' || i)::uuid,
      'stem', 'q' || i, 'options', jsonb_build_array('a','b','c','d'),
      'correct_index', 0, 'reference_answer', 'a', 'source_fingerprint', 'fp' || i)));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- ── 1) The run opens on what exists so far ───────────────────────────────
  r := start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  IF (r->>'item_count')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: run opened with % items', r->>'item_count';
  END IF;
  SELECT * INTO v_row FROM quiz_runs WHERE id = v_run;
  IF v_row.score_max <> 3 THEN
    RAISE EXCEPTION 'FAIL: score_max opened at %', v_row.score_max;
  END IF;

  -- Answer one correctly: 1 of 3 so far.
  v_items := get_quiz_run_items(v_run);
  v_item := (v_items->'items'->0->>'item_id')::uuid;
  PERFORM submit_quiz_answer(v_item, jsonb_build_object(
    'choice', (SELECT k - 1 FROM generate_subscripts(
                 (SELECT option_order FROM quiz_run_items WHERE id = v_item), 1) k
                WHERE (SELECT option_order FROM quiz_run_items WHERE id = v_item)[k] = 0)), 1000);

  -- ── 2) Batch 2 arrives mid-run ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR i IN 4..6 LOOP
    PERFORM persist_quiz_questions(v_set, jsonb_build_array(jsonb_build_object(
      'card_id', ('f1300000-0000-4000-8000-00000000000' || i)::uuid,
      'stem', 'q' || i, 'options', jsonb_build_array('a','b','c','d'),
      'correct_index', 0, 'reference_answer', 'a', 'source_fingerprint', 'fp' || i)));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  r := append_quiz_run_items(v_run);
  IF (r->>'added')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: appended % items', r->>'added';
  END IF;

  -- ── 3) THE CHECK THIS FILE EXISTS FOR ────────────────────────────────────
  -- The denominator grew by exactly what can now be answered. If `score_max` moved and
  -- `item_count` did not (or the reverse), a learner who had answered everything in front
  -- of them would watch their percentage fall as the quiz was written.
  SELECT * INTO v_row FROM quiz_runs WHERE id = v_run;
  IF v_row.item_count <> 6 OR v_row.score_max <> 6 THEN
    RAISE EXCEPTION 'FAIL: item_count=% score_max=% after append',
      v_row.item_count, v_row.score_max;
  END IF;
  IF v_row.score_raw <> 1 THEN
    RAISE EXCEPTION 'FAIL: an answer already given was disturbed (score_raw=%)', v_row.score_raw;
  END IF;

  -- The answered item is untouched and still answered.
  v_items := get_quiz_run_items(v_run);
  IF jsonb_array_length(v_items->'items') <> 6 THEN
    RAISE EXCEPTION 'FAIL: % items served after append', jsonb_array_length(v_items->'items');
  END IF;
  -- `graded`, not `answered`: multiple choice is settled the instant it is submitted. What
  -- matters is that exactly one item is no longer pending and the new ones all are.
  IF (SELECT count(*) FROM quiz_run_items
       WHERE run_id = v_run AND status <> 'pending') <> 1 THEN
    RAISE EXCEPTION 'FAIL: the answered item did not survive the append (%)',
      (SELECT jsonb_agg(status) FROM quiz_run_items WHERE run_id = v_run);
  END IF;

  -- ── 4) Appending again adds nothing ──────────────────────────────────────
  -- Called on every refresh, so it must be idempotent: a second copy would serve one
  -- question twice AND count it twice.
  r := append_quiz_run_items(v_run);
  IF (r->>'added')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: a repeat append added % items', r->>'added';
  END IF;
  SELECT * INTO v_row FROM quiz_runs WHERE id = v_run;
  IF v_row.item_count <> 6 OR v_row.score_max <> 6 THEN
    RAISE EXCEPTION 'FAIL: counters moved on a no-op append (%/%)',
      v_row.item_count, v_row.score_max;
  END IF;

  -- ── 5) A finished sitting is a record ────────────────────────────────────
  PERFORM finish_quiz_run(v_run);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM persist_quiz_questions(v_set, jsonb_build_array(jsonb_build_object(
    'card_id', 'f1300000-0000-4000-8000-000000000001'::uuid,
    'stem', 'late', 'options', jsonb_build_array('a','b','c','d'),
    'correct_index', 0, 'reference_answer', 'a', 'source_fingerprint', 'late')));
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  r := append_quiz_run_items(v_run);
  IF (r->>'added')::int <> 0 OR NOT (r->>'closed')::boolean THEN
    RAISE EXCEPTION 'FAIL: a completed run accepted new questions (%)', r;
  END IF;
  SELECT * INTO v_row FROM quiz_runs WHERE id = v_run;
  IF v_row.score_max <> 6 THEN
    RAISE EXCEPTION 'FAIL: a finished run''s denominator moved to %', v_row.score_max;
  END IF;

  -- ── 6) Not someone else's run ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM append_quiz_run_items(v_run);
    RAISE EXCEPTION 'FAIL: appended to another learner''s run';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

  RAISE NOTICE 'quiz_progressive_run_test: all assertions passed';
END;
$$;

ROLLBACK;
