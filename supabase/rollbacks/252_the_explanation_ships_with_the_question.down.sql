-- 252 되돌리기: 해설을 다시 유료 두 번째 호출로 되돌립니다.
--
-- 되돌리면 생성 때 쓴 축은 저장돼 있어도 **풀리지 않고**, 해설은 다시 답한 뒤 $0.05 에
-- 사는 것이 됩니다. `apply_quiz_explanation` 도 되살립니다 — 그 경로가 쓰는 함수입니다.
--
-- 순서: 값 행을 넣기 **전에** CHECK 를 넓혀야 합니다.
BEGIN;

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
      -- The learner's OWN submission, back to them.
      --
      -- `QuizFeedback` renders character spans the grader returned — "this part of your sentence
      -- is the problem" — by slicing the text the client already holds. During the run that is
      -- the input box. On the result screen, and on every later visit to a finished run, the
      -- client had nothing, so `splitBySpan('')` produced an empty hit and every learner span
      -- was dropped. The spans were paid for and then thrown away, which is the exact defect
      -- that component was written to fix.
      'response', a.response,
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
$function$;

ALTER TABLE public.ai_quiz_price_units
  DROP CONSTRAINT IF EXISTS ai_quiz_price_units_action_check;
ALTER TABLE public.ai_quiz_price_units
  ADD CONSTRAINT ai_quiz_price_units_action_check
  CHECK (action IN ('generate_mcq','generate_short','generate_essay',
                    'grade_mcq','grade_short','grade_essay'));

INSERT INTO public.ai_quiz_price_units (action, units, job_kind)
VALUES ('grade_mcq', 1, 'quiz_grade')
ON CONFLICT (action) DO NOTHING;

CREATE OR REPLACE FUNCTION public.apply_quiz_explanation(
  p_run_item_id uuid,
  p_evaluator_result jsonb,
  p_feedback    jsonb,
  p_evaluator_version text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item quiz_run_items%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  SELECT * INTO v_item FROM quiz_run_items WHERE id = p_run_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not found' USING errcode = 'P0003'; END IF;
  UPDATE answer_attempts
     SET evaluator_result = COALESCE(evaluator_result, '{}'::jsonb) || COALESCE(p_evaluator_result, '{}'::jsonb),
         feedback = p_feedback,
         evaluator_version = COALESCE(p_evaluator_version, evaluator_version)
   WHERE quiz_run_item_id = p_run_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No answer to explain' USING errcode = 'P0003'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_quiz_explanation(uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
