-- ============================================================================
-- 207: a quiz can be longer than one model call
--
-- ── The live bug this starts from ───────────────────────────────────────────
--
-- The edge function has always capped ONE generation call at `MAX_QUIZ_BATCH`:
-- 10 cards for multiple choice and short answer, 3 for essay (a rubric triples the
-- output tokens per item). Over that it refuses with AI_REQUEST_TOO_LARGE.
--
-- The client sends every card in one call, and the setup screen offers 4/6/8/10/12.
-- So, measured against production today:
--
--   서술형 4문항  →  ❌ AI_REQUEST_TOO_LARGE
--   객관식 12문항 →  ❌ on any deck with 12+ eligible cards
--
-- The essay case is the bad one: the SMALLEST option the screen offers is 4, and the
-- cap is 3, so **no essay quiz has ever been creatable from the UI**. It fails after
-- the learner has chosen everything and pressed the button.
--
-- ── Why batching rather than a bigger cap ───────────────────────────────────
--
-- The cap is not arbitrary. Measured on production today: five questions took 22.1
-- seconds, and `PROVIDER_TIMEOUT_MS` is 30 seconds. Twelve in one call does not fit in
-- the time budget even if the token budget allowed it, and raising the timeout just
-- moves the failure to the platform's own request ceiling.
--
-- So the call stays small and the QUIZ gets longer: the client chunks the card list and
-- invokes generation once per chunk, showing progress. Each call reserves, generates and
-- settles independently, which also means a batch that fails costs nothing and leaves the
-- batches that succeeded in place — partial delivery was already the model here.
--
-- ── What has to change in the database ──────────────────────────────────────
--
-- `persist_quiz_questions` was written for exactly one call per set: it numbers positions
-- from 0 and SETS `generated_count`. Called twice it would write a second question at
-- position 0 and report only the last batch's size. It now appends.
--
-- The count ceiling goes to 50. Nothing about 50 is special to the database — it is the
-- largest number the setup screen will offer, and a ceiling that is not enforced anywhere
-- is not a ceiling.
-- ============================================================================

BEGIN;

-- ── 1) Persisting a batch adds to the set ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.persist_quiz_questions(
  p_set_id    uuid,
  p_questions jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_set quiz_sets%ROWTYPE;
  q     jsonb;
  v_pos smallint;
  v_n   integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'questions must be an array' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not found' USING errcode = 'P0003'; END IF;

  -- Continue where the last batch stopped. Restarting at 0 would put two questions at the
  -- same position, and `get_quiz_run_items` orders by it.
  SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM quiz_questions WHERE set_id = p_set_id;

  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM cards WHERE id = (q->>'card_id')::uuid AND deck_id = v_set.deck_id
    ) THEN
      RAISE EXCEPTION 'Question card is not in this set''s deck' USING errcode = '42501';
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
      CASE WHEN jsonb_typeof(q->'rubric') = 'array' THEN q->'rubric' END,
      COALESCE(q->'meta', '{}'::jsonb),
      q->>'source_fingerprint');
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  -- ACCUMULATE. `= v_n` reported only the last batch, so a 30-question quiz built from
  -- three calls would have said it had 10.
  UPDATE quiz_sets
     SET generated_count = generated_count + v_n,
         updated_at = now()
   WHERE id = p_set_id;

  RETURN jsonb_build_object(
    'set_id', p_set_id,
    'persisted', v_n,
    'total', (SELECT generated_count FROM quiz_sets WHERE id = p_set_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persist_quiz_questions(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2) A quiz may be up to 50 questions ─────────────────────────────────────
--
-- Recreated from 202 with one bound changed. Everything else — the band lookup, the
-- guidance requirement, the eligibility count — is unchanged.
CREATE OR REPLACE FUNCTION public.create_quiz_set(
  p_deck_id        uuid,
  p_title          text,
  p_question_type  text,
  p_count          integer,
  p_content_locale text,
  p_scope_kind     text     DEFAULT 'deck',
  p_tags           text[]   DEFAULT '{}'::text[],
  p_card_ids       uuid[]   DEFAULT '{}'::uuid[],
  p_difficulty     smallint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_n     integer;
  v_band  quiz_difficulty_levels%ROWTYPE;
  v_guide text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF p_question_type NOT IN ('mcq', 'short', 'essay') THEN
    RAISE EXCEPTION 'Unknown question type' USING errcode = 'invalid_parameter_value';
  END IF;
  -- 207: was 12. The client now generates in batches, so the length of a quiz is no longer
  -- the length of one model call.
  IF p_count IS NULL OR p_count < 1 OR p_count > 50 THEN
    RAISE EXCEPTION 'Question count out of range' USING errcode = 'P0009';
  END IF;

  IF p_difficulty IS NULL THEN
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_default AND is_active;
    IF NOT FOUND THEN
      SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_active ORDER BY sort_order LIMIT 1;
    END IF;
  ELSE
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = p_difficulty AND is_active;
  END IF;
  IF NOT FOUND OR v_band.level IS NULL THEN
    RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'invalid_parameter_value';
  END IF;
  -- Verbatim from 202: a band with no guidance for this type cannot state what it means
  -- here, and generating anyway would produce a question at a difficulty nobody chose.
  v_guide := v_band.guidance ->> p_question_type;
  IF v_guide IS NULL OR btrim(v_guide) = '' THEN
    RAISE EXCEPTION 'This difficulty is not available for that question type'
      USING errcode = 'P0013';
  END IF;

  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
  IF p_question_type = 'mcq' AND v_n < v_band.option_count THEN
    RAISE EXCEPTION 'Not enough cards for multiple choice' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         scope_tags, scope_card_ids, requested_count, content_locale, difficulty)
    VALUES (v_uid, p_deck_id, p_title, p_question_type, p_scope_kind,
            CASE WHEN p_scope_kind = 'tags'  THEN p_tags     ELSE '{}'::text[] END,
            CASE WHEN p_scope_kind = 'cards' THEN p_card_ids ELSE '{}'::uuid[] END,
            LEAST(p_count, v_n), p_content_locale, v_band.level)
    RETURNING id INTO v_set;

  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key) ORDER BY ord)
    INTO v_cards
    FROM (SELECT card_id, answer_key, random() AS ord
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           ORDER BY random() LIMIT LEAST(p_count, v_n)) s;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', v_band.level,
                            'near_required', v_band.near_required,
                            'near_max', v_band.near_max,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;

COMMIT;
