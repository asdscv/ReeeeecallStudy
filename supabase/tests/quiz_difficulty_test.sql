-- ============================================================================
-- Quiz difficulty bands — the "make it a hundred later" test.
--
-- The requirement is not "three levels work". It is that going to five, ten or a hundred,
-- retuning one, or retiring one, costs an INSERT or an UPDATE and never a deploy. Everything
-- below is a way that could quietly stop being true:
--
--   * a CHECK that caps the level number,
--   * an axis so coarse that only four bands are distinguishable,
--   * a default frozen into the schema instead of chosen by data,
--   * a client that enumerates the bands it knows about,
--   * a flaw name in `allowed_flaws` that the edge contract does not have, which would make
--     a band silently unbuildable rather than loudly wrong.
--
-- The label side is guarded in TypeScript (`quiz-feedback-labels.test.ts`), because a missing
-- translation is a file problem, not a database one.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('a9000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'a9000000-0000-4000-8000-000000000001';
  v_tpl  uuid; v_deck uuid; v_set uuid; v_run uuid;
  r      jsonb; q jsonb;
  v_n    integer; v_txt text;
  i      integer;
BEGIN
  -- ── The ceiling is gone ───────────────────────────────────────────────────
  -- 197 shipped CHECK (level BETWEEN 1 AND 9). Ten was impossible; a hundred was absurd.
  -- Guidance included, because a band without it cannot say what it means and is refused.
  INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count, sort_order, guidance)
    VALUES (10, 2, 3, 4, 10, '{"mcq":"g10","short":"g10s","essay":"g10e"}'::jsonb),
           (42, 0, 1, 2, 42, '{"mcq":"g42"}'::jsonb),
           (100, 5, 5, 6, 100, '{"mcq":"g100","short":"g100s","essay":"g100e"}'::jsonb);

  SELECT count(*) INTO v_n FROM quiz_difficulty_levels WHERE level > 9;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL: high band numbers were rejected (% inserted)', v_n; END IF;

  -- ── The axes are wide enough for them to differ ───────────────────────────
  -- With near_required alone there are only four distinguishable bands, so a hundred levels
  -- would be ninety-six duplicates. option_count and allowed_flaws are what make them real.
  SELECT count(DISTINCT (near_required, near_max, option_count, allowed_flaws))
    INTO v_n FROM quiz_difficulty_levels;
  IF v_n < 5 THEN
    RAISE EXCEPTION 'FAIL: only % distinguishable band configurations exist', v_n;
  END IF;

  -- near_required cannot exceed the distractors the band actually has.
  BEGIN
    INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count, sort_order, guidance)
      VALUES (11, 4, 4, 4, 11, '{"mcq":"g"}'::jsonb);   -- 4 options = 3 distractors
    RAISE EXCEPTION 'FAIL: a band demanded more near-misses than it has distractors';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A band whose minimum exceeds its maximum is not a band.
  BEGIN
    INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count, sort_order, guidance)
      VALUES (12, 3, 1, 4, 12, '{"mcq":"g"}'::jsonb);
    RAISE EXCEPTION 'FAIL: a band with min > max was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── Exactly one default, and it is data ───────────────────────────────────
  SELECT count(*) INTO v_n FROM quiz_difficulty_levels WHERE is_default;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: % default bands', v_n; END IF;

  BEGIN
    UPDATE quiz_difficulty_levels SET is_default = true WHERE level = 10;
    RAISE EXCEPTION 'FAIL: a second default band was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── Every allowed_flaws entry exists in the edge contract ─────────────────
  -- A typo here does not fail loudly: the prompt would ask for a flaw the validator has never
  -- heard of, every item would be dropped, and the band would look like a model problem.
  UPDATE quiz_difficulty_levels SET allowed_flaws = ARRAY['plausible_form', 'unrelated']
   WHERE level = 100;
  SELECT string_agg(f, ',') INTO v_txt
    FROM quiz_difficulty_levels, unnest(allowed_flaws) f
   WHERE f NOT IN ('opposite', 'adjacent_sense', 'right_category_wrong_item',
                   'partial', 'overgeneral', 'plausible_form', 'unrelated');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: allowed_flaws names % which the edge contract does not define', v_txt;
  END IF;

  -- ── The listing is what the client renders, and it follows the data ───────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  q := public.get_quiz_difficulty_levels();
  IF jsonb_array_length(q) <> 6 THEN
    RAISE EXCEPTION 'FAIL: listing returned % bands, expected 6', jsonb_array_length(q);
  END IF;

  -- Retiring a band removes it from the list without destroying anything built at it.
  UPDATE quiz_difficulty_levels SET is_active = false WHERE level = 42;
  q := public.get_quiz_difficulty_levels();
  IF jsonb_array_length(q) <> 5 THEN
    RAISE EXCEPTION 'FAIL: a retired band is still offered (% listed)', jsonb_array_length(q);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM quiz_difficulty_levels WHERE level = 42) THEN
    RAISE EXCEPTION 'FAIL: retiring a band deleted it';
  END IF;

  -- ── A set can actually be built at a high band ────────────────────────────
  SELECT id INTO v_tpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'D', v_tpl)
    RETURNING id INTO v_deck;
  FOR i IN 1..8 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tpl,
              jsonb_build_object('field_1', 'w' || i, 'field_2', 'm' || i,
                                 'field_3', 'p' || i, 'field_4', 'e' || i));
  END LOOP;

  r := public.create_quiz_set(v_deck, 'high band', 'mcq', 3, 'en', 'deck', '{}', '{}', 100::smallint);
  IF (r->>'difficulty')::int <> 100 OR (r->>'option_count')::int <> 6
     OR (r->>'near_required')::int <> 5 OR (r->>'near_max')::int <> 5 THEN
    RAISE EXCEPTION 'FAIL: band 100 did not travel into the set: %', r;
  END IF;

  -- ...and a retired one cannot be chosen.
  BEGIN
    PERFORM public.create_quiz_set(v_deck, 'x', 'mcq', 3, 'en', 'deck', '{}', '{}', 42::smallint);
    RAISE EXCEPTION 'FAIL: a retired band was selectable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── Omitting the band follows the DATA default, not a compiled-in number ──
  -- This is what lets an older mobile build track the owner's current choice.
  UPDATE quiz_difficulty_levels SET is_default = false WHERE is_default;
  UPDATE quiz_difficulty_levels SET is_default = true WHERE level = 1;
  r := public.create_quiz_set(v_deck, 'default band', 'mcq', 3, 'en');
  IF (r->>'difficulty')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: omitting the band gave % instead of the default 1', r->>'difficulty';
  END IF;

  -- ── A six-option question runs, and its shuffle is a six-permutation ──────
  v_set := (r->>'set_id')::uuid;
  UPDATE quiz_sets SET difficulty = 100 WHERE id = v_set;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.persist_quiz_questions(v_set, jsonb_build_array(
    jsonb_build_object('card_id', (SELECT id FROM cards WHERE deck_id = v_deck LIMIT 1),
      'stem', 'six options', 'options', jsonb_build_array('a','b','c','d','e','f'),
      'correct_index', 4, 'reference_answer', 'e', 'source_fingerprint', 'fp')));
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  SELECT cardinality(option_order) INTO v_n FROM quiz_run_items WHERE run_id = v_run;
  IF v_n <> 6 THEN RAISE EXCEPTION 'FAIL: a six-option question shuffled % slots', v_n; END IF;

  q := public.get_quiz_run_items(v_run);
  IF jsonb_array_length(q->'items'->0->'options') <> 6 THEN
    RAISE EXCEPTION 'FAIL: only % options were served', jsonb_array_length(q->'items'->0->'options');
  END IF;

  -- Answering slot 5 must be reachable — the old bound was hardcoded at 3.
  r := public.submit_quiz_answer((q->'items'->0->>'item_id')::uuid, jsonb_build_object('choice', 5));
  IF (r->>'score') IS NULL THEN RAISE EXCEPTION 'FAIL: choice 5 was not gradeable'; END IF;

  -- ── A band is only offered for the types it has guidance for ─────────────
  -- A band with mcq guidance and nothing else. Generating an essay at it would produce a
  -- question at a difficulty nobody chose, so it is refused rather than defaulted.
  INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count, sort_order, guidance)
    VALUES (44, 0, 1, 4, 44, '{"mcq":"mcq only"}'::jsonb);
  BEGIN
    PERFORM public.create_quiz_set(v_deck, 'x', 'essay', 2, 'en', 'deck', '{}', '{}', 44::smallint);
    RAISE EXCEPTION 'FAIL: a band with no essay guidance produced an essay set';
  EXCEPTION WHEN sqlstate 'P0013' THEN NULL;
  END;

  -- Guidance must be a string keyed by a real question type; a typo would silently take the
  -- band offline for that type.
  BEGIN
    INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count, sort_order, guidance)
      VALUES (13, 0, 1, 4, 13, '{"mcqq":"typo"}'::jsonb);
    RAISE EXCEPTION 'FAIL: guidance accepted an unknown question type';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Retuning one type must not blank the others.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE quiz_difficulty_levels
     SET guidance = guidance || '{"essay":"retuned"}'::jsonb WHERE level = 10;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  IF (SELECT guidance ->> 'mcq' FROM quiz_difficulty_levels WHERE level = 10) IS NULL THEN
    RAISE EXCEPTION 'FAIL: retuning essay guidance blanked mcq';
  END IF;

  -- ── The deck-mate builder still works, and still refuses the wrong bands ──
  -- No client routes to it since mig 202 — every band is AI-generated now, because
  -- deck-mates are a multiple-choice-only trick and short answer and essay need a
  -- difficulty too. It is kept as a working escape hatch (a provider outage, or a future
  -- band that wants zero cost), so its guard is still worth pinning: it must never build a
  -- band that permits near-misses, which would hand the learner an easier quiz than they
  -- chose.
  r := public.create_quiz_set(v_deck, 'easy', 'mcq', 3, 'ko', 'deck', '{}', '{}', 1::smallint);
  q := public.build_deck_mate_quiz((r->>'set_id')::uuid);
  IF (q->>'persisted')::int <> 3 THEN
    RAISE EXCEPTION 'FAIL: deck-mate build produced % questions', q->>'persisted';
  END IF;
  IF (q->>'price_micro')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: the easy band was charged %', q->>'price_micro';
  END IF;

  -- Every option is a real answer from the deck, and the right one is among them.
  v_run := (public.start_quiz_run((r->>'set_id')::uuid)->>'run_id')::uuid;
  q := public.get_quiz_run_items(v_run);
  IF jsonb_array_length(q->'items'->0->'options') <> 4 THEN
    RAISE EXCEPTION 'FAIL: deck-mate question had % options', jsonb_array_length(q->'items'->0->'options');
  END IF;
  IF q::text LIKE '%correct_index%' THEN
    RAISE EXCEPTION 'FAIL: deck-mate build leaked the answer key';
  END IF;

  -- A band that PERMITS near-misses must not be built this way — it would hand the learner
  -- an easier quiz than the one they chose.
  r := public.create_quiz_set(v_deck, 'hard', 'mcq', 3, 'ko', 'deck', '{}', '{}', 3::smallint);
  BEGIN
    PERFORM public.build_deck_mate_quiz((r->>'set_id')::uuid);
    RAISE EXCEPTION 'FAIL: a near-miss band was built from deck-mates';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'quiz_difficulty_test: bands scale, retire, default from data, carry per-type guidance, run at 6 options';
END;
$$;

ROLLBACK;
