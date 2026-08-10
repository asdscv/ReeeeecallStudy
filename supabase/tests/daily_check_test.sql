-- Migration 205: 오늘의 확인.
--
-- The product claim being tested is a price claim as much as a learning one: building the
-- check costs nothing because the card is the question, and answering it costs nothing when
-- the learner is right. The learner pays only for the answers a string comparison could not
-- settle. If either half of that stops holding, this feature becomes a tax on studying.
--
-- So the assertions are: it builds from what was actually studied today, it never invents a
-- question, an exactly-right answer is graded free and instantly, a wrong one is left for the
-- paid grader, and re-opening the screen does not create a second set.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('d1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- A template that DECLARES which back field is the answer — the thing 205 relies on and
-- refuses to guess at.
INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout) VALUES (
  'd1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Check template',
  '[{"key":"word","type":"text"},{"key":"meaning","type":"text"},{"key":"note","type":"text"}]'::jsonb,
  '[{"field_key":"word","style":"primary"}]'::jsonb,
  '[{"field_key":"meaning","style":"primary"},{"field_key":"note","style":"detail"}]'::jsonb);

-- A template that does NOT say which field is the answer. Its cards must be dropped.
INSERT INTO card_templates (id, user_id, name, fields, front_layout, back_layout) VALUES (
  'd1100000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'Ambiguous template',
  '[{"key":"a","type":"text"},{"key":"b","type":"text"},{"key":"c","type":"text"}]'::jsonb,
  '[{"field_key":"a","style":"primary"}]'::jsonb,
  '[{"field_key":"b","style":"detail"},{"field_key":"c","style":"detail"}]'::jsonb);

INSERT INTO decks (id, user_id, name) VALUES
  ('d1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Check deck');

INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, created_at, field_values) VALUES
  ('d1300000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 1, now(),
   '{"word":"glacier","meaning":"빙하","note":"ice"}'::jsonb),
  ('d1300000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 2, now(),
   '{"word":"harbour","meaning":"항구","note":"port"}'::jsonb),
  -- Studied today but unresolvable: two undeclared back candidates.
  ('d1300000-0000-4000-8000-000000000003', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000002', 3, now(),
   '{"a":"x","b":"y","c":"z"}'::jsonb),
  -- Never studied. Must not appear.
  ('d1300000-0000-4000-8000-000000000004', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 4, now(),
   '{"word":"lullaby","meaning":"자장가","note":"song"}'::jsonb);

-- Three of the four were studied today, in the learner's zone.
INSERT INTO study_logs (user_id, card_id, deck_id, study_mode, rating, studied_at) VALUES
  ('d1000000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001',
   'd1200000-0000-4000-8000-000000000001','srs','good', now()),
  ('d1000000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002',
   'd1200000-0000-4000-8000-000000000001','srs','hard', now()),
  ('d1000000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000003',
   'd1200000-0000-4000-8000-000000000001','srs','good', now());
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_counts jsonb;
  v_built  jsonb;
  v_again  jsonb;
  v_set    uuid;
  v_run    uuid;
  v_items  jsonb;
  v_it     jsonb;
  v_res    jsonb;
  v_glacier uuid;
  v_harbour uuid;
  v_n      integer;
  v_tz     text := 'Asia/Seoul';
BEGIN
  -- ── 1) The count is honest about what can be checked ─────────────────────
  v_counts := count_daily_check_cards(v_tz);
  IF (v_counts->>'studied_today')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: studied_today is %', v_counts->>'studied_today';
  END IF;
  -- The ambiguous-template card is studied but not checkable. Counting it would put a
  -- number on the button that the build cannot deliver.
  IF (v_counts->>'checkable')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: checkable is % (expected 2)', v_counts->>'checkable';
  END IF;

  -- ── 2) Build: free, from today only, never invented ──────────────────────
  v_built := build_daily_check(NULL, v_tz, 8);
  v_set := (v_built->>'set_id')::uuid;
  IF (v_built->>'persisted')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: persisted % questions', v_built->>'persisted';
  END IF;
  IF (v_built->>'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: building the check was priced at %', v_built->>'price_micro';
  END IF;

  -- The card never studied must not be in it.
  IF EXISTS (SELECT 1 FROM quiz_questions
              WHERE set_id = v_set AND card_id = 'd1300000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'FAIL: a card that was not studied today was included';
  END IF;
  -- Nor the one whose template does not declare an answer.
  IF EXISTS (SELECT 1 FROM quiz_questions
              WHERE set_id = v_set AND card_id = 'd1300000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL: a card with no declared answer field was included';
  END IF;

  -- The question is the card's own prompt and the reference is its own answer. Nothing
  -- was generated, so this is an equality, not an approximation.
  IF NOT EXISTS (SELECT 1 FROM quiz_questions
                  WHERE set_id = v_set AND card_id = 'd1300000-0000-4000-8000-000000000001'
                    AND stem = 'glacier' AND reference_answer = '빙하') THEN
    RAISE EXCEPTION 'FAIL: the question is not the card verbatim: %',
      (SELECT jsonb_agg(jsonb_build_object('stem', stem, 'ref', reference_answer))
         FROM quiz_questions WHERE set_id = v_set);
  END IF;

  -- ── 3) Opening it again reuses the set ───────────────────────────────────
  v_again := build_daily_check(NULL, v_tz, 8);
  IF (v_again->>'set_id')::uuid <> v_set OR NOT (v_again->>'reused')::boolean THEN
    RAISE EXCEPTION 'FAIL: a second call created another set (%)', v_again;
  END IF;
  SELECT count(*) INTO v_n FROM quiz_sets
   WHERE owner_user_id = 'd1000000-0000-4000-8000-000000000001' AND title = '__daily_check__';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: % daily-check sets exist', v_n; END IF;

  -- ── 4) THE PRICE CLAIM: a right answer is graded free, instantly ─────────
  v_run := (start_quiz_run(v_set)->>'run_id')::uuid;
  v_items := get_quiz_run_items(v_run);

  SELECT (i->>'item_id')::uuid INTO v_glacier
    FROM jsonb_array_elements(v_items->'items') i WHERE i->>'stem' = 'glacier';
  SELECT (i->>'item_id')::uuid INTO v_harbour
    FROM jsonb_array_elements(v_items->'items') i WHERE i->>'stem' = 'harbour';

  -- Typed with trailing punctuation and spaces, which must fold away.
  v_res := submit_quiz_answer(v_glacier, jsonb_build_object('text', '  빙하. '), 3000);
  IF NOT (v_res->>'graded')::boolean OR (v_res->>'score')::numeric <> 1 THEN
    RAISE EXCEPTION 'FAIL: an exactly-right answer was not graded free: %', v_res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM answer_attempts
                  WHERE quiz_run_item_id = v_glacier AND evaluator_type = 'exact') THEN
    RAISE EXCEPTION 'FAIL: the free grade did not record evaluator_type = exact';
  END IF;
  -- The learner typed it, so echoing it back discloses nothing.
  IF v_res->>'reference_answer' IS DISTINCT FROM '빙하' THEN
    RAISE EXCEPTION 'FAIL: the reference was withheld from a learner who typed it: %', v_res;
  END IF;

  -- ── 5) A wrong answer stays for the paid grader ──────────────────────────
  v_res := submit_quiz_answer(v_harbour, jsonb_build_object('text', '공항'), 3000);
  IF (v_res->>'graded')::boolean THEN
    RAISE EXCEPTION 'FAIL: a wrong answer was graded without the grader: %', v_res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM answer_attempts
                  WHERE quiz_run_item_id = v_harbour AND evaluator_type = 'ai'
                    AND normalized_score IS NULL) THEN
    RAISE EXCEPTION 'FAIL: the ungraded answer is not queued for the grader';
  END IF;
  -- And the answer is NOT revealed: the learner has not earned it and the grader has
  -- not spoken.
  IF v_res->>'reference_answer' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a wrong answer leaked the reference: %', v_res;
  END IF;

  -- ── 6) The learner's day, however their runtime names their zone ─────────
  -- `resolveTimezoneLabel()` returns an IANA name when the runtime has ICU and a
  -- `UTC±HH:MM` label when it does not — which is the Hermes build the mobile app ships.
  -- `AT TIME ZONE` reads the second form with POSIX sign conventions, i.e. BACKWARDS, so
  -- the two must be asserted to agree or ICU-less learners get a day up to 18 hours off.
  IF public._local_date(timestamptz '2026-08-10 20:00+00', 'Asia/Seoul')
     <> public._local_date(timestamptz '2026-08-10 20:00+00', 'UTC+09:00') THEN
    RAISE EXCEPTION 'FAIL: offset label disagrees with the IANA zone (% vs %)',
      public._local_date(timestamptz '2026-08-10 20:00+00', 'Asia/Seoul'),
      public._local_date(timestamptz '2026-08-10 20:00+00', 'UTC+09:00');
  END IF;
  IF public._local_date(timestamptz '2026-08-10 20:00+00', 'UTC-03:30')
     <> date '2026-08-10' THEN
    RAISE EXCEPTION 'FAIL: a negative offset label resolved to %',
      public._local_date(timestamptz '2026-08-10 20:00+00', 'UTC-03:30');
  END IF;
  -- An unparseable zone must fall back rather than raise: a bad label from one device
  -- must not make the feature unreachable.
  IF public._local_date(timestamptz '2026-08-10 20:00+00', 'nonsense') <> date '2026-08-10' THEN
    RAISE EXCEPTION 'FAIL: an unknown zone did not fall back to UTC';
  END IF;

  RAISE NOTICE 'daily_check_test: all assertions passed';
END;
$$;

ROLLBACK;
