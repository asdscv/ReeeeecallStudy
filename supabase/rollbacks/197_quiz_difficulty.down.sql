-- Rollback for 197 (quiz difficulty bands).
--
-- Restores `create_quiz_set` and `persist_quiz_questions` to their 195/196 signatures and drops
-- the band table and the two columns.
--
-- What reverting costs, stated so it is a decision: every multiple-choice item goes back to the
-- hardest possible band — all three wrong options near-misses — which is a good question for
-- someone who nearly knows the word and a hostile one for someone meeting the deck today.
--
-- `difficulty` is dropped from `quiz_sets` and `quiz_questions` rather than kept, because a
-- column referencing a dropped table is not a column anyone can read. Sets already generated
-- keep their questions; only the record of WHICH band they were built for is lost.

BEGIN;

-- 1) The 9-argument create_quiz_set has to go before the table it references.
DROP FUNCTION IF EXISTS public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint);

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

  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key) ORDER BY ord)
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

-- 2) persist_quiz_questions without the band stamp.
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
      rubric, meta, source_fingerprint)
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

-- 3) The columns, then the table they point at.
DROP FUNCTION IF EXISTS public.get_quiz_difficulty_levels();
ALTER TABLE public.quiz_questions DROP COLUMN IF EXISTS difficulty;
ALTER TABLE public.quiz_sets      DROP COLUMN IF EXISTS difficulty;
DROP TABLE IF EXISTS public.quiz_difficulty_levels;

COMMIT;
