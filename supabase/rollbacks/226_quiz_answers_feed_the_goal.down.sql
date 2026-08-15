-- Rollback 226: quiz answers stop being evidence for anything.
--
-- Restores the insert without `goal_id`. The 오답 노트 still reads them (it filters by user, not
-- goal), but the learning engine goes back to seeing none of them: accuracy, weak cards and
-- tomorrow's plan are all goal-scoped. Backfilled rows are left as they are — the goal on them is
-- correct, and clearing it would destroy information this migration did not invent.
CREATE OR REPLACE FUNCTION public.submit_quiz_answer(p_run_item_id uuid, p_response jsonb, p_duration_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Bounded by what was actually shown, not by a hardcoded 3.
    IF v_choice IS NULL OR v_choice < 0 OR v_choice >= cardinality(v_item.option_order) THEN
      RAISE EXCEPTION 'choice is outside the options shown' USING errcode = 'invalid_parameter_value';
    END IF;
    v_canon  := v_item.option_order[v_choice + 1];
    v_correct := v_canon = v_q.correct_index;
    v_score  := CASE WHEN v_correct THEN 1 ELSE 0 END;
    v_rtype  := 'choice'; v_etype := 'choice';
  ELSE
    IF coalesce(btrim(p_response->>'text'), '') = '' THEN
      RAISE EXCEPTION 'answer text is required' USING errcode = 'invalid_parameter_value';
    END IF;
    v_rtype := 'text';
    -- 205: a short answer that IS the answer is settled here, free, by string comparison.
    -- `_normalize_answer` folds width, case and punctuation exactly as the TypeScript grader
    -- does, so "빙하." and "빙하" are one string. Charging a learner to be told they typed the
    -- right word is the same mistake as charging for multiple-choice grading, which
    -- `ai_quiz_price_units` omits on purpose.
    --
    -- Essays are never settled this way: their reference is a model answer, not a key, and an
    -- exact match against it would mean nothing.
    IF v_q.question_type = 'short'
       AND coalesce(v_q.reference_answer, '') <> ''
       AND public._normalize_answer(p_response->>'text') = public._normalize_answer(v_q.reference_answer)
    THEN
      v_score := 1;
      v_etype := 'exact';
    ELSE
      v_score := NULL;
      v_etype := CASE WHEN v_q.question_type = 'essay' THEN 'rubric' ELSE 'ai' END;
    END IF;
  END IF;

  INSERT INTO answer_attempts (
    user_id, card_id, quiz_run_item_id, client_attempt_id,
    activity_type, response_type, evaluator_type,
    response, normalized_score, duration_ms)
  VALUES (
    v_uid, v_q.card_id, p_run_item_id, gen_random_uuid(),
    CASE WHEN v_q.question_type = 'essay' THEN 'produce' ELSE 'recall' END,
    v_rtype, v_etype,
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
    'correct_display_index', CASE WHEN v_q.question_type = 'mcq'
      THEN (SELECT k - 1 FROM generate_subscripts(v_item.option_order, 1) k
             WHERE v_item.option_order[k] = v_q.correct_index) END,
    -- Revealed once the item is settled: multiple choice always, and a short answer the
    -- learner got exactly right — they typed it, so it discloses nothing.
    'reference_answer', CASE WHEN v_q.question_type = 'mcq' OR v_etype = 'exact'
                             THEN v_q.reference_answer END);
END;
$function$

;

REVOKE EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) TO authenticated;
