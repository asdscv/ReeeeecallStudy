-- Rollback 222: the learner's answer stops coming back, and the misses list disappears.
--
-- Restores 208's get_quiz_run_items (no `response` key), so every `from: "learner"` grading span
-- renders as nothing on the result screen again. Drops the two mistake reads; they write nothing,
-- so there is no data to unwind.
DROP FUNCTION IF EXISTS public.get_quiz_mistakes(uuid, integer);
DROP FUNCTION IF EXISTS public.count_quiz_mistakes(uuid);

CREATE OR REPLACE FUNCTION public.get_quiz_run_items(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'options', CASE WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                      THEN to_jsonb(ARRAY(SELECT q.options[i.option_order[k] + 1]
                                            FROM generate_subscripts(i.option_order, 1) k))
                 END,
      'answered', a.id IS NOT NULL,
      'score', a.normalized_score,
      'feedback', a.feedback,
      -- AFTER answering only. `meta.flaws` names why each wrong option is wrong, so it is
      -- an answer key until the learner has committed.
      --
      -- And permuted with the options. Stored order is canonical; served order is this
      -- sitting's shuffle. Returning the stored array beside the shuffled options made the
      -- payload claim two different correct answers.
      'meta', CASE WHEN a.id IS NULL THEN NULL
                   WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                        AND jsonb_typeof(q.meta -> 'flaws') = 'array'
                   THEN q.meta || jsonb_build_object('flaws', (
                          SELECT COALESCE(jsonb_agg(q.meta -> 'flaws' -> i.option_order[k]
                                                    ORDER BY k), '[]'::jsonb)
                            FROM generate_subscripts(i.option_order, 1) k))
                   ELSE q.meta END,
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
    -- 208: what the SET is still aiming for. A long quiz opens on its first batch, so a
    -- screen needs the target to know whether more is coming — and to stop asking once it
    -- is not.
    'requested_count', (SELECT requested_count FROM quiz_sets WHERE id = v_run.set_id),
    'items', COALESCE(v_items, '[]'::jsonb));
END;
$function$

;
