-- Down for 238: back to shuffling the first forty rows instead of sampling.
--
-- Restores 220's filler SELECT exactly. A deck with more than forty eligible cards will again
-- draw every far distractor from the same fixed forty — which is the state this rolls back to,
-- not a new fault.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_quiz_set(p_deck_id uuid, p_title text, p_question_type text, p_count integer, p_content_locale text, p_scope_kind text DEFAULT 'deck'::text, p_tags text[] DEFAULT '{}'::text[], p_card_ids uuid[] DEFAULT '{}'::uuid[], p_difficulty smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_fillers text[];
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

  -- Other answers from the same deck, to fill the FAR distractor slots a band leaves open.
  -- 220's version: the LIMIT takes the first forty and the shuffle only reorders them, so a
  -- deck larger than forty cards offers the same forty wrong answers to every quiz.
  SELECT array_agg(a ORDER BY random()) INTO v_fillers
    FROM (SELECT DISTINCT answer_text AS a
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           LIMIT 40) f;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', v_band.level,
                            'near_required', v_band.near_required,
                            'near_max', v_band.near_max,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'fillers', to_jsonb(COALESCE(v_fillers, '{}'::text[])),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint) TO authenticated;

COMMIT;
