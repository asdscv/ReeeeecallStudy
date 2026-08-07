-- ============================================================================
-- 197: how hard the wrong options are, as data rather than as code
--
-- ── What shipped, and what was wrong with it ────────────────────────────────
--
-- Multiple choice generated the hardest possible item every time. Run against a
-- real deck it produced, for `lend`:
--
--     빌리다 · 빌려가다 · 임대하다 · 빌려주다(정답)
--
-- Every wrong option is a near-miss. That is a good item for someone who nearly
-- knows the word and a hostile one for someone meeting the deck today, who is not
-- served by four shades of "lend" — they are served by "which of these is even in
-- the right area".
--
-- ── The axis, and why it is a number ────────────────────────────────────────
--
-- Difficulty here is not a mood, it is a COUNT: how many of the three distractors
-- are near-misses. `NEAR_FLAWS` / `FAR_FLAWS` in ai-quiz.ts split the flaw
-- vocabulary along exactly that line, and `unrelated` was added so that "all far"
-- is expressible at all.
--
--     near 0  →  빌려주다 · 도착하다 · 달리다        recognising the area is enough
--     near 1  →  빌려주다 · 빌리다 · 사랑하다        one real trap
--     near 3  →  빌려주다 · 빌리다 · 빌려가다 · 임대하다   you must know the word
--
-- Stated as a count, the model follows it; stated as "easy", it interprets it and
-- writes near-misses anyway, because easy is the shape it has least practice at.
-- `validateMultipleChoiceGeneration` therefore CHECKS the count and drops an item
-- that misses it, rather than trusting the instruction.
--
-- ── Why a table ────────────────────────────────────────────────────────────
--
-- "Add a level" must not mean "ship a migration and a deploy". A band is a row: a
-- number, a near-count, and a sort position. Adding a fourth band, or retuning the
-- second, is an INSERT or an UPDATE. Nothing in the client enumerates the levels —
-- it lists whatever `get_quiz_difficulty_levels` returns and passes the number back.
--
-- The label is NOT stored here. A row cannot carry eight translations, and a label
-- that came from the database would bypass the i18n gates entirely. The client
-- renders `t('difficulty.' || level)` and the label test asserts every active level
-- has a string in all sixteen files — so adding a band without translating it fails
-- the build rather than showing a learner a bare number.
-- ============================================================================

BEGIN;

CREATE TABLE public.quiz_difficulty_levels (
  level         smallint PRIMARY KEY CHECK (level BETWEEN 1 AND 9),
  -- How many of the three distractors must be near-misses. The whole knob, today.
  near_required smallint NOT NULL CHECK (near_required BETWEEN 0 AND 3),
  sort_order    smallint NOT NULL,
  is_active     boolean  NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quiz_difficulty_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read the bands" ON public.quiz_difficulty_levels
  FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.quiz_difficulty_levels TO authenticated;
GRANT ALL ON public.quiz_difficulty_levels TO service_role;

INSERT INTO public.quiz_difficulty_levels (level, near_required, sort_order) VALUES
  (1, 0, 1),   -- all far: recognising the subject area is enough
  (2, 1, 2),   -- one real trap among three
  (3, 3, 3);   -- all near-misses: what the feature shipped as, now opt-in

COMMENT ON TABLE public.quiz_difficulty_levels IS
  'Distractor difficulty bands. `near_required` is how many of the three wrong options must be near-misses; adding or retuning a band is an INSERT/UPDATE, never a deploy. Labels live in i18n, not here.';

-- ── The chosen band travels with the set and with each question ─────────────
--
-- On the SET because it is what the learner picked, and on the QUESTION because a
-- set can be regenerated and an item must remember the band it was built for —
-- otherwise a retake reports a difficulty the questions do not have.
ALTER TABLE public.quiz_sets
  ADD COLUMN IF NOT EXISTS difficulty smallint NOT NULL DEFAULT 3
    REFERENCES public.quiz_difficulty_levels(level);
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS difficulty smallint;

-- ── Readable list for the setup screen ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('level', level, 'near_required', near_required)
                            ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

-- ── create_quiz_set takes a band ────────────────────────────────────────────
--
-- Body reproduced from 195 with the new parameter, so this file is the whole current
-- definition rather than a diff to chase. Defaulted to 3 so an older client — a mobile
-- build that has not taken the OTA yet — keeps the behaviour it was written against.
CREATE OR REPLACE FUNCTION public.create_quiz_set(
  p_deck_id        uuid,
  p_title          text,
  p_question_type  text,
  p_count          integer,
  p_content_locale text,
  p_scope_kind     text     DEFAULT 'deck',
  p_tags           text[]   DEFAULT '{}'::text[],
  p_card_ids       uuid[]   DEFAULT '{}'::uuid[],
  p_difficulty     smallint DEFAULT 3
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_n     integer;
  v_near  smallint;
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

  -- An inactive or unknown band is refused rather than silently coerced: a learner who
  -- picked "easy" and got the hardest items would have no way to tell.
  SELECT near_required INTO v_near
    FROM quiz_difficulty_levels WHERE level = p_difficulty AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
  IF p_question_type = 'mcq' AND v_n < 4 THEN
    RAISE EXCEPTION 'Not enough cards for multiple choice' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         scope_tags, scope_card_ids, requested_count, content_locale, difficulty)
    VALUES (v_uid, p_deck_id, p_title, p_question_type, p_scope_kind,
            CASE WHEN p_scope_kind = 'tags'  THEN p_tags     ELSE '{}'::text[] END,
            CASE WHEN p_scope_kind = 'cards' THEN p_card_ids ELSE '{}'::uuid[] END,
            LEAST(p_count, v_n), p_content_locale, p_difficulty)
    RETURNING id INTO v_set;

  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key)
                   ORDER BY ord)
    INTO v_cards
    FROM (SELECT card_id, answer_key, random() AS ord
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           ORDER BY random() LIMIT LEAST(p_count, v_n)) s;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', p_difficulty, 'near_required', v_near,
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;
-- The 8-argument form from 195 is gone: PostgREST would otherwise resolve a 9-arg call
-- ambiguously, and leaving both means a client that omits the band silently gets the old one.
DROP FUNCTION IF EXISTS public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[]);

-- ── persist_quiz_questions stamps the band onto each question ───────────────
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
    IF NOT EXISTS (
      SELECT 1 FROM cards WHERE id = (q->>'card_id')::uuid AND deck_id = v_set.deck_id
    ) THEN
      RAISE EXCEPTION 'Question card is not in this set deck' USING errcode = '42501';
    END IF;

    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      options, correct_index, reference_answer, reference_context,
      rubric, meta, source_fingerprint, difficulty)
    VALUES (
      p_set_id, v_set.owner_user_id, (q->>'card_id')::uuid, v_set.question_type, v_pos,
      q->>'stem',
      CASE WHEN v_set.question_type = 'mcq'
           THEN ARRAY(SELECT jsonb_array_elements_text(q->'options')) END,
      CASE WHEN v_set.question_type = 'mcq' THEN (q->>'correct_index')::smallint END,
      q->>'reference_answer',
      q->>'reference_context',
      CASE WHEN v_set.question_type = 'essay' THEN q->'rubric' END,
      COALESCE(q->'meta', '{}'::jsonb),
      q->>'source_fingerprint',
      -- From the SET, not from the payload: the band is the learner's choice and the
      -- edge function must not be able to record a different one than they picked.
      v_set.difficulty);
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  UPDATE quiz_sets SET generated_count = v_n, updated_at = now() WHERE id = p_set_id;
  RETURN jsonb_build_object('set_id', p_set_id, 'persisted', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persist_quiz_questions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMIT;
