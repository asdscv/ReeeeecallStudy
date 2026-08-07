-- ============================================================================
-- 195: Quiz — selection, presentation, and grading
--
-- ── The one thing every function here is protecting ─────────────────────────
--
-- The learner must not be able to obtain the answer to a question they are about to
-- be asked. 193 removed the table grants that would have made that trivial; this file
-- is the other half, because a function is only as safe as what it projects.
-- `get_quiz_run_items` is the sole read path, and it returns the stem and the options
-- in display order and NOTHING else — not `correct_index`, not `option_order`, not
-- `reference_answer`. Grading happens server-side against rows the client never saw.
--
-- ── Eligibility is a rule stated in three places, deliberately ──────────────
--
-- `_quiz_eligible_cards` below reproduces `resolveQuizCardFaces`
-- (packages/shared/lib/quiz-answer-field.ts and its edge twin). Three copies of one
-- rule is a real cost, and the alternative was worse in both directions: counting
-- eligible cards in TypeScript means shipping every card in a 561-card deck to the
-- client to answer "how many can I quiz", and selecting them in TypeScript means the
-- edge function fetching the whole deck to pick twelve rows.
--
-- So SQL owns SELECTION and COUNTING; TypeScript owns EXTRACTION. They agree because
-- they are tested against the same fixtures — the seeded 097 templates — in
-- quiz_run_rpcs_test.sql and quiz-answer-field.test.ts. If you change one, change all
-- three; the tests are written so that failing to is loud.
--
--   eligible ⇔ at least one non-empty `text` field named by front_layout
--            ∧ exactly one `primary` non-empty `text` field named by back_layout
--              (or, with no `primary` at all, exactly one such field in total)
--            ∧ that field is not also on the front
--
-- ── Option order ────────────────────────────────────────────────────────────
--
-- `quiz_run_items.option_order[k]` is the CANONICAL index of the option shown at
-- display position k-1. A learner submits a display position; the server maps it back
-- through the same array. A fresh permutation per sitting means a retake cannot be
-- passed by remembering where the answer sat, and because the array never leaves the
-- server, the position carries no information to a client that inspects its traffic.
-- ============================================================================

BEGIN;

-- ── 1) Which cards can be quizzed ───────────────────────────────────────────
--
-- Set-returning and SECURITY DEFINER: it reads `cards` and `card_templates` for decks
-- the caller may not own rows in directly (a subscribed official deck), so access is
-- checked by the callers below rather than by RLS.
CREATE OR REPLACE FUNCTION public._quiz_eligible_cards(
  p_uid        uuid,
  p_deck_id    uuid,
  p_scope_kind text   DEFAULT 'deck',
  p_tags       text[] DEFAULT '{}'::text[],
  p_card_ids   uuid[] DEFAULT '{}'::uuid[]
) RETURNS TABLE (card_id uuid, answer_key text, answer_text text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH scoped AS (
    SELECT c.id, c.field_values, c.template_id
    FROM cards c
    WHERE c.deck_id = p_deck_id
      AND (p_scope_kind <> 'tags'  OR c.tags && p_tags)
      AND (p_scope_kind <> 'cards' OR c.id = ANY(p_card_ids))
  ),
  tpl AS (
    SELECT t.id,
           (SELECT jsonb_object_agg(f->>'key', f->>'type')
              FROM jsonb_array_elements(t.fields) f) AS ftype,
           t.front_layout, t.back_layout
    FROM card_templates t
    WHERE t.id IN (SELECT DISTINCT template_id FROM scoped)
  ),
  -- Front: any non-empty text field. Presence is all that matters here.
  front AS (
    SELECT s.id AS card_id, array_agg(DISTINCT fl->>'field_key') AS keys
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL jsonb_array_elements(tpl.front_layout) fl
    WHERE tpl.ftype ->> (fl->>'field_key') = 'text'
      AND coalesce(btrim(s.field_values ->> (fl->>'field_key')), '') <> ''
    GROUP BY s.id
  ),
  -- Back: the candidates, and which of them the author marked primary.
  back AS (
    SELECT s.id AS card_id,
           count(*) AS cand_n,
           count(*) FILTER (WHERE bl->>'style' = 'primary') AS primary_n,
           min(bl->>'field_key') FILTER (WHERE bl->>'style' = 'primary') AS primary_key,
           min(bl->>'field_key') AS only_key
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL jsonb_array_elements(tpl.back_layout) bl
    WHERE tpl.ftype ->> (bl->>'field_key') = 'text'
      AND coalesce(btrim(s.field_values ->> (bl->>'field_key')), '') <> ''
    GROUP BY s.id
  )
  SELECT s.id,
         k.answer_key,
         btrim(s.field_values ->> k.answer_key)
  FROM scoped s
  JOIN front f ON f.card_id = s.id
  JOIN back  b ON b.card_id = s.id
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN b.primary_n = 1 THEN b.primary_key
             WHEN b.primary_n = 0 AND b.cand_n = 1 THEN b.only_key
           END AS answer_key
  ) k
  WHERE k.answer_key IS NOT NULL
    AND NOT (k.answer_key = ANY(f.keys));
$$;
REVOKE EXECUTE ON FUNCTION public._quiz_eligible_cards(uuid, uuid, text, text[], uuid[])
  FROM PUBLIC, anon, authenticated;

-- ── 2) The number the setup screen quotes against ───────────────────────────
CREATE OR REPLACE FUNCTION public.count_quizzable_cards(
  p_deck_id    uuid,
  p_scope_kind text   DEFAULT 'deck',
  p_tags       text[] DEFAULT '{}'::text[],
  p_card_ids   uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_total bigint;
  v_elig  bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM cards c
   WHERE c.deck_id = p_deck_id
     AND (p_scope_kind <> 'tags'  OR c.tags && p_tags)
     AND (p_scope_kind <> 'cards' OR c.id = ANY(p_card_ids));
  SELECT count(*) INTO v_elig
    FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);

  -- `total` is returned alongside so the screen can say WHY a deck is unquizzable —
  -- "0 of 561" is a template problem the learner can fix, and "0 of 0" is an empty
  -- scope. One number cannot tell those apart.
  RETURN jsonb_build_object('total', v_total, 'eligible', v_elig);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_quizzable_cards(uuid, text, text[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_quizzable_cards(uuid, text, text[], uuid[]) TO authenticated;

-- ── 3) Create the set, and hand the edge function its work list ─────────────
--
-- Returns the CARDS to build questions from, chosen here rather than in the edge
-- function, so the selection is made once by the same rule that counted them.
CREATE OR REPLACE FUNCTION public.create_quiz_set(
  p_deck_id       uuid,
  p_title         text,
  p_question_type text,
  p_count         integer,
  p_content_locale text,
  p_scope_kind    text   DEFAULT 'deck',
  p_tags          text[] DEFAULT '{}'::text[],
  p_card_ids      uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_n     integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF p_question_type NOT IN ('mcq', 'short', 'essay') THEN
    RAISE EXCEPTION 'Unknown question type' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 12 THEN
    RAISE EXCEPTION 'Question count out of range' USING errcode = 'P0009';
  END IF;

  -- Multiple choice needs three other cards to draw plausible distractors from, and a
  -- deck that cannot supply them produces a quiz where the answer is obvious by
  -- elimination. Refuse rather than ship that.
  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
  IF p_question_type = 'mcq' AND v_n < 4 THEN
    RAISE EXCEPTION 'Not enough cards for multiple choice' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         scope_tags, scope_card_ids, requested_count, content_locale)
    VALUES (v_uid, p_deck_id, p_title, p_question_type, p_scope_kind,
            CASE WHEN p_scope_kind = 'tags'  THEN p_tags     ELSE '{}'::text[] END,
            CASE WHEN p_scope_kind = 'cards' THEN p_card_ids ELSE '{}'::uuid[] END,
            LEAST(p_count, v_n), p_content_locale)
    RETURNING id INTO v_set;

  -- random() and not "the oldest N": a learner who generates two sets over the same
  -- deck should not get the same questions twice.
  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key)
                   ORDER BY ord)
    INTO v_cards
    FROM (SELECT card_id, answer_key, random() AS ord
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           ORDER BY random() LIMIT LEAST(p_count, v_n)) s;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n), 'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[])
  TO authenticated;

-- ── 4) Persist what the model produced. Service role only. ──────────────────
--
-- The correct answer arrives as `reference_answer`, resolved server-side from the
-- card. It is never taken from the model's output — for multiple choice the model
-- returns distractors only, and this function is where the card's own answer is put
-- into the option array at a position the model had no say in.
CREATE OR REPLACE FUNCTION public.persist_quiz_questions(
  p_set_id    uuid,
  p_questions jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_set   quiz_sets%ROWTYPE;
  q       jsonb;
  v_n     integer := 0;
  v_pos   smallint := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'questions must be an array' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not found' USING errcode = 'P0003'; END IF;

  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    -- Every question must name a card that is IN this set's deck. Without this the
    -- edge function could be induced to attach a question derived from someone else's
    -- card to a set the caller owns.
    IF NOT EXISTS (
      SELECT 1 FROM cards WHERE id = (q->>'card_id')::uuid AND deck_id = v_set.deck_id
    ) THEN
      RAISE EXCEPTION 'Question card is not in this set deck' USING errcode = '42501';
    END IF;

    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      options, correct_index, reference_answer, reference_context,
      rubric, meta, source_fingerprint)
    VALUES (
      p_set_id, v_set.owner_user_id, (q->>'card_id')::uuid, v_set.question_type, v_pos,
      q->>'stem',
      CASE WHEN v_set.question_type = 'mcq'
           THEN ARRAY(SELECT jsonb_array_elements_text(q->'options')) END,
      CASE WHEN v_set.question_type = 'mcq' THEN (q->>'correct_index')::smallint END,
      q->>'reference_answer',
      q->>'reference_context',
      -- Stored with the question so a learner is graded against the rubric they were
      -- shown, not against whatever the generator would produce today.
      CASE WHEN v_set.question_type = 'essay' THEN q->'rubric' END,
      COALESCE(q->'meta', '{}'::jsonb),
      q->>'source_fingerprint');
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  UPDATE quiz_sets SET generated_count = v_n, updated_at = now() WHERE id = p_set_id;
  RETURN jsonb_build_object('set_id', p_set_id, 'persisted', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persist_quiz_questions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── 5) Start a sitting ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_quiz_run(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_set     quiz_sets%ROWTYPE;
  v_run     uuid;
  v_attempt smallint;
  v_n       integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501'; END IF;

  SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt
    FROM quiz_runs WHERE set_id = p_set_id AND user_id = v_uid;
  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = p_set_id;

  INSERT INTO quiz_runs (set_id, user_id, attempt_no, item_count, score_max)
    VALUES (p_set_id, v_uid, v_attempt, v_n, v_n) RETURNING id INTO v_run;

  -- A fresh shuffle per sitting. Questions keep the set's order; only the options move.
  INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
  SELECT v_run, q.id, q.position,
         CASE WHEN q.question_type = 'mcq'
              THEN ARRAY(SELECT i FROM generate_series(0, 3) i ORDER BY random())::smallint[]
         END
  FROM quiz_questions q WHERE q.set_id = p_set_id ORDER BY q.position;

  RETURN jsonb_build_object('run_id', v_run, 'attempt_no', v_attempt, 'item_count', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_quiz_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_quiz_run(uuid) TO authenticated;

-- ── 6) The only read path a client gets ─────────────────────────────────────
--
-- Projects the stem and, for multiple choice, the options already permuted into
-- display order. `correct_index`, `option_order` and `reference_answer` are not in the
-- result and there is no parameter that would add them.
CREATE OR REPLACE FUNCTION public.get_quiz_run_items(p_run_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_run   quiz_runs%ROWTYPE;
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = p_run_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz run not accessible' USING errcode = '42501'; END IF;

  SELECT jsonb_agg(x ORDER BY x->>'position') INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'item_id', i.id,
      'position', i.position,
      'status', i.status,
      'question_type', q.question_type,
      'stem', q.stem,
      -- Display order. `option_order[k]` is the canonical index shown at position k-1,
      -- so this reads the canonical array through the permutation.
      'options', CASE WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                      THEN to_jsonb(ARRAY(SELECT q.options[i.option_order[k] + 1]
                                            FROM generate_subscripts(i.option_order, 1) k))
                 END,
      'answered', a.id IS NOT NULL,
      'score', a.normalized_score,
      'feedback', a.feedback,
      -- AFTER answering only, and this is not a nicety. `meta.flaws` is parallel to the
      -- options with null at the correct one, and an essay rubric's `mustMention` terms
      -- are quoted out of the card's own answer. Either one shipped early hands over
      -- exactly what get_quiz_run_items exists to withhold.
      'meta',   CASE WHEN a.id IS NOT NULL THEN q.meta END,
      'rubric', CASE WHEN a.id IS NOT NULL THEN q.rubric END,
      'reference_answer', CASE WHEN a.id IS NOT NULL THEN q.reference_answer END
    ) AS x
    FROM quiz_run_items i
    LEFT JOIN quiz_questions q ON q.id = i.question_id
    LEFT JOIN answer_attempts a ON a.quiz_run_item_id = i.id
    WHERE i.run_id = p_run_id AND i.status <> 'void'
  ) s;

  RETURN jsonb_build_object(
    'run_id', p_run_id, 'set_id', v_run.set_id, 'status', v_run.status,
    'attempt_no', v_run.attempt_no, 'item_count', v_run.item_count,
    'answered_count', v_run.answered_count,
    'score_raw', v_run.score_raw, 'score_max', v_run.score_max,
    'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) TO authenticated;

-- ── 7) Submit an answer ─────────────────────────────────────────────────────
--
-- Multiple choice is graded HERE, in full, for free — index comparison has no
-- marginal cost, and routing it through an AI call would be paying for arithmetic.
-- Short and essay are recorded ungraded; the edge function grades them and calls
-- `apply_quiz_grade`.
CREATE OR REPLACE FUNCTION public.submit_quiz_answer(
  p_run_item_id uuid,
  p_response    jsonb,
  p_duration_ms integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_item    quiz_run_items%ROWTYPE;
  v_q       quiz_questions%ROWTYPE;
  v_run     quiz_runs%ROWTYPE;
  v_choice  smallint;
  v_canon   smallint;
  v_correct boolean;
  v_score   numeric;
  v_attempt uuid;
  v_rtype   text;
  v_etype   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT i.* INTO v_item FROM quiz_run_items i
    JOIN quiz_runs r ON r.id = i.run_id
   WHERE i.id = p_run_item_id AND r.user_id = v_uid
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not accessible' USING errcode = '42501'; END IF;
  -- `void` is checked BEFORE `pending`, and separately. The orphan trigger voids items
  -- whose card was deleted mid-sitting, and reporting that as "already answered" tells
  -- the learner something that is both false and unactionable — they would look for an
  -- answer they never gave.
  IF v_item.status = 'void' OR v_item.question_id IS NULL THEN
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'Item already answered' USING errcode = 'P0011';
  END IF;

  SELECT * INTO v_q FROM quiz_questions WHERE id = v_item.question_id;
  IF NOT FOUND THEN
    UPDATE quiz_run_items SET status = 'void' WHERE id = p_run_item_id;
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = v_item.run_id FOR UPDATE;

  IF v_q.question_type = 'mcq' THEN
    v_choice := (p_response->>'choice')::smallint;
    IF v_choice IS NULL OR v_choice < 0 OR v_choice > 3 THEN
      RAISE EXCEPTION 'choice must be 0..3' USING errcode = 'invalid_parameter_value';
    END IF;
    -- Display position back to canonical index, through the permutation the client
    -- never received.
    v_canon  := v_item.option_order[v_choice + 1];
    v_correct := v_canon = v_q.correct_index;
    v_score  := CASE WHEN v_correct THEN 1 ELSE 0 END;
    v_rtype  := 'choice'; v_etype := 'choice';
  ELSE
    IF coalesce(btrim(p_response->>'text'), '') = '' THEN
      RAISE EXCEPTION 'answer text is required' USING errcode = 'invalid_parameter_value';
    END IF;
    v_score := NULL;   -- awaiting the grader
    v_rtype := 'text'; v_etype := CASE WHEN v_q.question_type = 'essay' THEN 'rubric' ELSE 'ai' END;
  END IF;

  INSERT INTO answer_attempts (
    user_id, card_id, quiz_run_item_id, client_attempt_id,
    activity_type, response_type, evaluator_type,
    response, normalized_score, duration_ms)
  VALUES (
    v_uid, v_q.card_id, p_run_item_id, gen_random_uuid(),
    CASE WHEN v_q.question_type = 'essay' THEN 'produce' ELSE 'recall' END,
    v_rtype, v_etype,
    -- COALESCE because `duration_ms` is NOT NULL DEFAULT 0 and an explicit NULL does
    -- not fall back to a default. A client that does not time the answer records 0.
    p_response, v_score, COALESCE(p_duration_ms, 0))
  RETURNING id INTO v_attempt;

  UPDATE quiz_run_items
     SET status = CASE WHEN v_score IS NULL THEN 'answered' ELSE 'graded' END
   WHERE id = p_run_item_id;
  UPDATE quiz_runs
     SET answered_count = answered_count + 1,
         score_raw = score_raw + COALESCE(v_score, 0)
   WHERE id = v_item.run_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt,
    'graded', v_score IS NOT NULL,
    'score', v_score,
    -- Only after answering, and only for multiple choice, where knowing the right
    -- option teaches nothing about the questions still to come.
    'correct_display_index', CASE WHEN v_q.question_type = 'mcq'
      THEN (SELECT k - 1 FROM generate_subscripts(v_item.option_order, 1) k
             WHERE v_item.option_order[k] = v_q.correct_index) END,
    'reference_answer', CASE WHEN v_q.question_type = 'mcq' THEN v_q.reference_answer END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) TO authenticated;

-- ── 8) Write an AI grade. Service role only. ────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_quiz_grade(
  p_run_item_id uuid,
  p_score       numeric,
  p_evaluator_result jsonb,
  p_feedback    jsonb,
  p_evaluator_version text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item quiz_run_items%ROWTYPE;
  v_prev numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RAISE EXCEPTION 'score must be within [0,1]' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_item FROM quiz_run_items WHERE id = p_run_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not found' USING errcode = 'P0003'; END IF;

  SELECT normalized_score INTO v_prev FROM answer_attempts WHERE quiz_run_item_id = p_run_item_id;
  UPDATE answer_attempts
     SET normalized_score = p_score,
         evaluator_result = p_evaluator_result,
         feedback = p_feedback,
         evaluator_version = p_evaluator_version
   WHERE quiz_run_item_id = p_run_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No answer to grade' USING errcode = 'P0003'; END IF;

  UPDATE quiz_run_items SET status = 'graded' WHERE id = p_run_item_id;
  UPDATE quiz_runs SET score_raw = GREATEST(0, score_raw - COALESCE(v_prev, 0) + p_score)
   WHERE id = v_item.run_id;

  RETURN jsonb_build_object('ok', true, 'score', p_score);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_quiz_grade(uuid, numeric, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

-- ── 9) The learner overrules the grader. Free, and both ways. ───────────────
--
-- An AI grade the learner cannot contest is worse than no grade: they are told they
-- are wrong with no recourse, by a machine, about their own card. This exists so the
-- score is theirs. It costs nothing, because charging for a correction would make the
-- correction a second sale on a failure we caused.
--
-- Both directions on purpose. "I was actually right" alone would make this an appeals
-- window and would quietly inflate every score; "I was actually wrong" makes it what
-- it is — the learner's own judgement, which is what self-rating always was.
CREATE OR REPLACE FUNCTION public.override_quiz_grade(
  p_run_item_id uuid,
  p_score       numeric
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_item quiz_run_items%ROWTYPE;
  v_prev numeric;
  v_res  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RAISE EXCEPTION 'score must be within [0,1]' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT i.* INTO v_item FROM quiz_run_items i
    JOIN quiz_runs r ON r.id = i.run_id
   WHERE i.id = p_run_item_id AND r.user_id = v_uid
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not accessible' USING errcode = '42501'; END IF;

  SELECT normalized_score, evaluator_result INTO v_prev, v_res
    FROM answer_attempts WHERE quiz_run_item_id = p_run_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No answer to override' USING errcode = 'P0003'; END IF;

  UPDATE answer_attempts
     SET normalized_score = p_score,
         evaluator_type = 'self_rate',
         -- The machine's verdict is kept, not overwritten. Without it there is no way
         -- to ever measure how often the grader is overruled, which is the only signal
         -- that would tell us the grader is bad.
         evaluator_result = COALESCE(v_res, '{}'::jsonb)
           || jsonb_build_object('overridden_from', v_prev, 'overridden_at', now())
   WHERE quiz_run_item_id = p_run_item_id;

  UPDATE quiz_runs SET score_raw = GREATEST(0, score_raw - COALESCE(v_prev, 0) + p_score)
   WHERE id = v_item.run_id;

  RETURN jsonb_build_object('ok', true, 'score', p_score, 'previous', v_prev);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.override_quiz_grade(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_quiz_grade(uuid, numeric) TO authenticated;

-- ── 10) Close a sitting ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_quiz_run(p_run_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run quiz_runs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  UPDATE quiz_runs
     SET status = 'completed', completed_at = now()
   WHERE id = p_run_id AND user_id = v_uid AND status = 'in_progress'
   RETURNING * INTO v_run;
  IF NOT FOUND THEN
    SELECT * INTO v_run FROM quiz_runs WHERE id = p_run_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Quiz run not accessible' USING errcode = '42501'; END IF;
  END IF;
  RETURN jsonb_build_object('run_id', p_run_id, 'status', v_run.status,
                            'score_raw', v_run.score_raw, 'score_max', v_run.score_max);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finish_quiz_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_quiz_run(uuid) TO authenticated;

COMMIT;
