-- Quiz run RPCs (migration 195) — selection, presentation, grading.
--
-- The property that matters most is negative: NOTHING a client can call returns the correct
-- answer before the question is answered. 193 removed the table grants; this checks the other
-- half, because a SECURITY DEFINER function is only as safe as the columns it projects.
--
-- The eligibility fixtures are the SEEDED templates from migration 097, chosen so that this file
-- and packages/web/src/lib/__tests__/quiz-answer-field.test.ts assert the same rule against the
-- same shapes in two languages. `_quiz_eligible_cards` is the third copy of that rule and the
-- only one without a type checker; these cases are what stops it drifting.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid   uuid := 'e1000000-0000-4000-8000-000000000001';
  v_other uuid := 'e2000000-0000-4000-8000-000000000002';
  v_en    uuid; v_zh uuid; v_amb uuid;
  v_deck  uuid; v_zdeck uuid; v_adeck uuid; v_odeck uuid;
  v_set   uuid;
  v_card  uuid;
  r       jsonb;
  items   jsonb;
  it      jsonb;
  v_run   uuid;
  v_item  uuid;
  v_n     integer;
  v_correct smallint;
  v_score numeric;
  v_res   jsonb;
  v_etype text;
  i       integer;
BEGIN
  -- ── Templates: the REAL seeded ones, not copies ──────────────────────────
  --
  -- `auth.users` insertion seeds them (migration 097), so this asserts against the
  -- shapes production actually has rather than against a restatement of them that
  -- could drift. 영어 단어 has three text fields on the back with one `primary`;
  -- 중국어 단어 is the same plus an audio field, which is the case `card-answer.ts`
  -- refuses outright and quiz must not.
  SELECT id INTO v_en FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  SELECT id INTO v_zh FROM card_templates WHERE user_id = v_uid AND name = '중국어 단어';
  IF v_en IS NULL OR v_zh IS NULL THEN
    RAISE EXCEPTION 'FAIL: seeded templates missing — mig 097 seeding did not run';
  END IF;

  -- No primary, two text candidates on the back: undeclared, therefore ineligible.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout) VALUES (
    v_uid, 'ambiguous',
    '[{"key":"a","name":"a","type":"text","order":0},{"key":"b","name":"b","type":"text","order":1},{"key":"c","name":"c","type":"text","order":2}]'::jsonb,
    '[{"field_key":"a","style":"primary"}]'::jsonb,
    '[{"field_key":"b","style":"hint"},{"field_key":"c","style":"detail"}]'::jsonb
  ) RETURNING id INTO v_amb;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'EN', v_en) RETURNING id INTO v_deck;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'ZH', v_zh) RETURNING id INTO v_zdeck;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'AMB', v_amb) RETURNING id INTO v_adeck;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_other, 'OTHER', v_en) RETURNING id INTO v_odeck;

  FOR i IN 1..6 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values, tags)
      VALUES (v_deck, v_uid, v_en,
              jsonb_build_object('field_1', 'w' || i, 'field_2', 'm' || i,
                                 'field_3', 'p' || i, 'field_4', 'e' || i),
              CASE WHEN i <= 2 THEN ARRAY['unit1'] ELSE ARRAY['unit2'] END);
  END LOOP;
  INSERT INTO cards (deck_id, user_id, template_id, field_values) VALUES
    (v_zdeck, v_uid, v_zh, '{"field_1":"借","field_2":"빌리다","field_3":"jiè","field_4":"我借了","field_5":"a.mp3"}'::jsonb),
    (v_adeck, v_uid, v_amb, '{"a":"A","b":"B","c":"C"}'::jsonb);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ── 1) Eligibility matches the TypeScript rule, shape for shape ──────────
  r := public.count_quizzable_cards(v_deck);
  IF (r->>'total')::int <> 6 OR (r->>'eligible')::int <> 6 THEN
    RAISE EXCEPTION 'FAIL: seeded English deck: %', r;
  END IF;

  -- Audio on the back does NOT disqualify: the answer is one field, and the clip beside
  -- it changes nothing about what the learner must produce. card-answer.ts nulls this card.
  r := public.count_quizzable_cards(v_zdeck);
  IF (r->>'eligible')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: Chinese template card should be quizzable: %', r;
  END IF;

  -- No primary and two candidates: refused rather than guessed by layout order.
  r := public.count_quizzable_cards(v_adeck);
  IF (r->>'total')::int <> 1 OR (r->>'eligible')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: ambiguous back was resolved anyway: %', r;
  END IF;

  -- Tag scope narrows the count.
  r := public.count_quizzable_cards(v_deck, 'tags', ARRAY['unit1']);
  IF (r->>'eligible')::int <> 2 THEN RAISE EXCEPTION 'FAIL: tag scope: %', r; END IF;

  -- ── 2) Another learner's deck is not countable or creatable against ──────
  BEGIN
    PERFORM public.count_quizzable_cards(v_odeck);
    RAISE EXCEPTION 'FAIL: counted another learner deck';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_quiz_set(v_odeck, 'X', 'mcq', 4, 'en');
    RAISE EXCEPTION 'FAIL: created a set over another learner deck';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── 3) Multiple choice needs four cards to draw distractors from ─────────
  BEGIN
    PERFORM public.create_quiz_set(v_zdeck, 'X', 'mcq', 4, 'en');
    RAISE EXCEPTION 'FAIL: built multiple choice from a one-card deck';
  EXCEPTION WHEN sqlstate 'P0010' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_quiz_set(v_adeck, 'X', 'short', 4, 'en');
    RAISE EXCEPTION 'FAIL: built a set over a deck with no eligible cards';
  EXCEPTION WHEN sqlstate 'P0010' THEN NULL;
  END;

  -- ── 4) Create, persist, run ──────────────────────────────────────────────
  r := public.create_quiz_set(v_deck, 'Set', 'mcq', 4, 'ko');
  v_set := (r->>'set_id')::uuid;
  IF jsonb_array_length(r->'cards') <> 4 THEN
    RAISE EXCEPTION 'FAIL: work list was % cards', jsonb_array_length(r->'cards');
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT id INTO v_card FROM cards WHERE deck_id = v_deck ORDER BY created_at LIMIT 1;
  r := public.persist_quiz_questions(v_set, jsonb_build_array(
    jsonb_build_object('card_id', v_card, 'stem', 'What does w1 mean?',
      'options', jsonb_build_array('m1', 'm2', 'm3', 'm4'), 'correct_index', 0,
      'reference_answer', 'm1', 'reference_context', 'p1', 'source_fingerprint', 'fp1')));
  IF (r->>'persisted')::int <> 1 THEN RAISE EXCEPTION 'FAIL: persist: %', r; END IF;

  -- A question whose card is not in this set's deck is refused, so a compromised edge
  -- call cannot attach someone else's card to a set the caller owns.
  BEGIN
    PERFORM public.persist_quiz_questions(v_set, jsonb_build_array(
      jsonb_build_object('card_id', (SELECT id FROM cards WHERE deck_id = v_zdeck LIMIT 1),
        'stem', 'x', 'options', jsonb_build_array('a','b','c','d'), 'correct_index', 0,
        'reference_answer', 'a', 'source_fingerprint', 'fp')));
    RAISE EXCEPTION 'FAIL: attached a foreign card question to this set';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  IF (r->>'item_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL: run item count: %', r; END IF;

  -- ── 5) THE CHECK THIS FILE EXISTS FOR: no answer leaks before answering ──
  items := public.get_quiz_run_items(v_run);
  it := items->'items'->0;
  IF it ? 'correct_index' OR it ? 'option_order' THEN
    RAISE EXCEPTION 'FAIL: run items exposed the answer key: %', it;
  END IF;
  -- Present as keys, but NULL until answered. `meta.flaws` is parallel to the options with
  -- null at the correct one; an essay rubric quotes terms out of the card's own answer.
  IF it->>'reference_answer' IS NOT NULL OR it->>'meta' IS NOT NULL OR it->>'rubric' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: post-answer fields were served before answering: %', it;
  END IF;
  IF items::text LIKE '%correct_index%' OR items::text LIKE '%option_order%'
     OR items::text LIKE '%"m1"%' THEN
    -- 'm1' is the correct option's text; it must appear only inside the shuffled option list.
    IF (SELECT count(*) FROM jsonb_array_elements_text(it->'options') v WHERE v = 'm1') <> 1 THEN
      RAISE EXCEPTION 'FAIL: answer key appeared outside the option list: %', items;
    END IF;
  END IF;
  IF jsonb_array_length(it->'options') <> 4 THEN
    RAISE EXCEPTION 'FAIL: options were not projected: %', it;
  END IF;
  -- The four options are the four canonical ones, permuted — not truncated, not repeated.
  IF (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(it->'options') v) <> 4 THEN
    RAISE EXCEPTION 'FAIL: options are not a permutation: %', it->'options';
  END IF;
  v_item := (it->>'item_id')::uuid;

  -- ── 6) Grading maps display position back through the permutation ────────
  -- Find where 'm1' (the canonical correct option) is being shown, and answer there.
  SELECT k - 1 INTO v_correct
    FROM jsonb_array_elements_text(it->'options') WITH ORDINALITY AS o(v, k)
   WHERE o.v = 'm1';

  r := public.submit_quiz_answer(v_item, jsonb_build_object('choice', v_correct), 1200);
  IF (r->>'graded')::boolean IS NOT TRUE OR (r->>'score')::numeric <> 1 THEN
    RAISE EXCEPTION 'FAIL: correct choice was not scored 1: %', r;
  END IF;
  IF (r->>'correct_display_index')::int <> v_correct THEN
    RAISE EXCEPTION 'FAIL: reported correct index % but answer was at %', r, v_correct;
  END IF;

  -- ...and only NOW do the post-answer fields appear.
  items := public.get_quiz_run_items(v_run);
  it := items->'items'->0;
  IF it->>'reference_answer' IS DISTINCT FROM 'm1' THEN
    RAISE EXCEPTION 'FAIL: reference answer withheld after answering: %', it;
  END IF;

  -- Answering twice is refused, so a double submit cannot inflate the run score.
  BEGIN
    PERFORM public.submit_quiz_answer(v_item, jsonb_build_object('choice', 0));
    RAISE EXCEPTION 'FAIL: item was answerable twice';
  EXCEPTION WHEN sqlstate 'P0011' THEN NULL;
  END;

  SELECT score_raw INTO v_score FROM quiz_runs WHERE id = v_run;
  IF v_score <> 1 THEN RAISE EXCEPTION 'FAIL: run score is %', v_score; END IF;

  -- ── 7) A wrong choice scores 0, on a second sitting ─────────────────────
  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  items := public.get_quiz_run_items(v_run);
  it := items->'items'->0;
  v_item := (it->>'item_id')::uuid;
  SELECT k - 1 INTO v_correct
    FROM jsonb_array_elements_text(it->'options') WITH ORDINALITY AS o(v, k)
   WHERE o.v = 'm1';
  r := public.submit_quiz_answer(v_item, jsonb_build_object('choice', (v_correct + 1) % 4));
  IF (r->>'score')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL: a wrong choice scored %', r->>'score';
  END IF;

  -- ── 8) The learner can overrule the grade, both ways, for free ──────────
  r := public.override_quiz_grade(v_item, 1.0);
  IF (r->>'score')::numeric <> 1 OR (r->>'previous')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL: override: %', r;
  END IF;
  SELECT score_raw INTO v_score FROM quiz_runs WHERE id = v_run;
  IF v_score <> 1 THEN RAISE EXCEPTION 'FAIL: run score after override is %', v_score; END IF;

  -- The machine's verdict survives the override — otherwise there is no way to ever
  -- measure how often the grader is overruled.
  SELECT evaluator_result, evaluator_type INTO v_res, v_etype
    FROM answer_attempts WHERE quiz_run_item_id = v_item;
  IF NOT (v_res ? 'overridden_from') THEN
    RAISE EXCEPTION 'FAIL: override discarded the original verdict: %', v_res;
  END IF;
  IF v_etype <> 'self_rate' THEN
    RAISE EXCEPTION 'FAIL: overridden attempt still claims evaluator %', v_etype;
  END IF;

  -- ...and it is not reachable on someone else's run.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.override_quiz_grade(v_item, 1.0);
    RAISE EXCEPTION 'FAIL: overrode another learner grade';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_quiz_run_items(v_run);
    RAISE EXCEPTION 'FAIL: read another learner run';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ── 9) A deleted card voids its item and cannot be answered ─────────────
  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  items := public.get_quiz_run_items(v_run);
  v_item := (items->'items'->0->>'item_id')::uuid;

  DELETE FROM cards WHERE id = v_card;

  BEGIN
    PERFORM public.submit_quiz_answer(v_item, jsonb_build_object('choice', 0));
    RAISE EXCEPTION 'FAIL: answered a question whose card was deleted';
  EXCEPTION WHEN sqlstate 'P0012' THEN NULL;
  END;

  items := public.get_quiz_run_items(v_run);
  IF jsonb_array_length(items->'items') <> 0 THEN
    RAISE EXCEPTION 'FAIL: voided item was still presented: %', items;
  END IF;

  RAISE NOTICE 'quiz_run_rpcs_test: all assertions passed';
END;
$$;

ROLLBACK;
