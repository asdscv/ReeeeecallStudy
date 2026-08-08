-- ============================================================================
-- 200: the easy band builds itself, from the deck
--
-- ── What kept failing ───────────────────────────────────────────────────────
--
-- Bands 1 and 2 asked the model for distractors that are NOT near-misses, and it
-- would not produce them. Asked for wrong options for `lend → 빌려주다` it returns
-- 빌리다, 갚다, 임대하다 — other transaction verbs — every time, at every phrasing
-- of the instruction. Three deploys of prompt tuning moved nothing:
--
--   1단  →  every item dropped: wrong_difficulty_mix
--   2단  →  every item dropped: wrong_difficulty_mix
--   3단  →  fine, because near-misses are what it wants to write anyway
--
-- That is not a prompt problem. Producing a deliberately unrelated wrong answer is
-- the one thing a language model is worst at, because everything it knows pulls
-- toward the semantic neighbourhood of the prompt.
--
-- ── Where the distractors were all along ────────────────────────────────────
--
-- Drawing distractors from OTHER CARDS IN THE SAME DECK was considered and rejected
-- early, for a specific and correct reason: for `apple` it yields 사과/책상/의자/
-- 자동차, and the answer is visible without knowing anything. No learning value.
--
-- That objection was about the HARD band. It is a precise description of what the
-- EASY band is for. A learner meeting a deck today is served by "which of these four
-- is even the right kind of thing", and deck-mates give exactly that — plus three
-- properties the model could not be made to deliver:
--
--   * they are guaranteed to be in the answer's own language and script;
--   * they are guaranteed to be wrong, because they are another card's answer;
--   * they cost nothing, because no model is called.
--
-- So the easy band is FREE, which is also the right shape for a funnel: the band a
-- beginner starts on does not touch their wallet.
--
-- ── What this does not do ───────────────────────────────────────────────────
--
-- It does not touch bands with `near_max > 0`. Those still go to the model, which is
-- good at them. A band is easy here precisely when it has ruled near-misses out.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.build_deck_mate_quiz(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_set    quiz_sets%ROWTYPE;
  v_band   quiz_difficulty_levels%ROWTYPE;
  v_pos    smallint := 0;
  v_n      integer := 0;
  r        record;
  v_others text[];
  v_opts   text[];
  v_correct smallint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501'; END IF;
  IF v_set.question_type <> 'mcq' THEN
    RAISE EXCEPTION 'Deck-mate questions are multiple choice only'
      USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_set.generated_count > 0 THEN
    RAISE EXCEPTION 'This set already has questions' USING errcode = 'P0011';
  END IF;

  SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = v_set.difficulty;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'P0003'; END IF;
  -- The guard that keeps this honest. A band that permits near-misses is a band the model
  -- is good at, and building it from deck-mates would quietly hand the learner an easier
  -- quiz than the one they chose.
  IF v_band.near_max > 0 THEN
    RAISE EXCEPTION 'This band needs generated distractors' USING errcode = 'invalid_parameter_value';
  END IF;

  -- Every eligible answer in scope, once. `_quiz_eligible_cards` is the same resolver the
  -- count and the AI path use, so "quizzable" means one thing everywhere.
  SELECT array_agg(DISTINCT answer_text) INTO v_others
    FROM _quiz_eligible_cards(v_uid, v_set.deck_id, v_set.scope_kind,
                              v_set.scope_tags, v_set.scope_card_ids);
  IF v_others IS NULL OR cardinality(v_others) < v_band.option_count THEN
    RAISE EXCEPTION 'Not enough distinct answers in scope' USING errcode = 'P0010';
  END IF;

  FOR r IN
    SELECT card_id, answer_text, prompt_text
      FROM (
        SELECT e.card_id, e.answer_text,
               btrim(concat_ws(' / ', VARIADIC ARRAY(
                 SELECT btrim(c.field_values ->> (fl->>'field_key'))
                   FROM jsonb_array_elements(t.front_layout) fl
                  WHERE coalesce(btrim(c.field_values ->> (fl->>'field_key')), '') <> ''
               ))) AS prompt_text,
               random() AS ord
          FROM _quiz_eligible_cards(v_uid, v_set.deck_id, v_set.scope_kind,
                                    v_set.scope_tags, v_set.scope_card_ids) e
          JOIN cards c ON c.id = e.card_id
          JOIN card_templates t ON t.id = c.template_id
      ) s
     ORDER BY ord
     LIMIT v_set.requested_count
  LOOP
    -- option_count - 1 other answers, chosen at random, never equal to this card's.
    SELECT array_agg(v ORDER BY random()) INTO v_opts
      FROM (SELECT unnest(v_others) AS v) x
     WHERE v <> r.answer_text
     LIMIT v_band.option_count - 1;

    IF v_opts IS NULL OR cardinality(v_opts) < v_band.option_count - 1 THEN
      CONTINUE;
    END IF;
    v_opts := (SELECT array_agg(v) FROM (SELECT unnest(v_opts) v LIMIT v_band.option_count - 1) y);

    -- The answer goes in at a position derived from the set and the card, so it is stable
    -- across a regeneration and carries no information the client could read.
    v_correct := (abs(hashtext(p_set_id::text || r.card_id::text))
                  % v_band.option_count)::smallint;
    v_opts := v_opts[1:v_correct] || ARRAY[r.answer_text] || v_opts[v_correct + 1:];

    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      options, correct_index, reference_answer, source_fingerprint, difficulty, meta)
    VALUES (
      p_set_id, v_uid, r.card_id, 'mcq', v_pos,
      -- The card's own prompt, verbatim. No model wrote any part of this question.
      r.prompt_text,
      v_opts, v_correct, r.answer_text,
      md5(r.prompt_text || ' ' || r.answer_text), v_set.difficulty,
      jsonb_build_object('source', 'deck_mates'));
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Could not build any question from this deck' USING errcode = 'P0010';
  END IF;

  UPDATE quiz_sets SET generated_count = v_n, updated_at = now() WHERE id = p_set_id;
  RETURN jsonb_build_object('set_id', p_set_id, 'persisted', v_n, 'source', 'deck_mates',
                            'price_micro', 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.build_deck_mate_quiz(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_deck_mate_quiz(uuid) TO authenticated;

COMMENT ON FUNCTION public.build_deck_mate_quiz(uuid) IS
  'Fill an EASY multiple-choice set from other answers in the same deck, with no model call and no charge. Only for bands with near_max = 0: deck-mates are wrong options a learner can rule out by recognising the subject, which is what the easy band promises and the one thing a language model reliably will not write.';

COMMIT;
