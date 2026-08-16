-- 222: the learner's own answer, and a record of what they got wrong.
--
-- Two things the app already had and could not show.
--
-- FIRST: `get_quiz_run_items` never returned the learner's submission. `QuizFeedback` renders the
-- character spans a paid grading call produced — "this clause is the problem", "this is what you
-- missed" — by slicing text the client holds. During a run that is the input box, so the spans
-- render. On the result screen, and on every later visit to a finished run, the client holds
-- nothing: `splitBySpan('')` returns an empty hit and every `from: "learner"` span is silently
-- dropped. Tokens bought, rendered once, gone. It is one key on a payload that already joins the
-- attempt row.
--
-- SECOND: there was no way to ask "what have I been getting wrong?". Every wrong quiz answer is
-- already recorded — `answer_attempts` carries the card, the response, the score and the run item
-- — and nothing ever read it back. `get_quiz_mistakes` is that read: the learner's misses, newest
-- first, with the card they came from, so the app can offer them for restudy.
--
-- Deliberately a READ over data that already exists, and nothing else. It writes nothing, moves no
-- SRS schedule, and creates no second source of truth about what a learner knows. A quiz answer
-- silently rescheduling reviews would let a casual sitting rearrange weeks of study; showing the
-- misses and letting the learner choose to restudy them keeps that decision theirs.
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

-- ── what I have been getting wrong ─────────────────────────────────────────
--
-- One row per missed quiz item: the question, the learner's own words, the answer they were
-- graded against, and the card, so the caller can offer "study these again" with the card ids it
-- already knows how to take (`StudyConfig.cardIds`).
--
-- Below 0.75 is a miss, which is `CORRECT_AT` in `packages/shared/lib/quiz-outcome.ts` and the
-- grader's own KNOWN band. The screen and this list must not disagree about the same answer: a
-- learner told "맞음" who then finds it in their 오답 노트 would trust neither.
--
-- Ungraded answers are NOT misses. A learner who declined to pay for a grade has not got it
-- wrong, and putting them here would charge them a mistake for not spending.
CREATE OR REPLACE FUNCTION public.get_quiz_mistakes(
  p_deck_id uuid    DEFAULT NULL,
  p_limit   integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  SELECT jsonb_agg(x ORDER BY x->>'answered_at' DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'attempt_id', a.id,
      'card_id', a.card_id,
      'deck_id', c.deck_id,
      'deck_name', d.name,
      'question_type', q.question_type,
      'stem', q.stem,
      'reference_answer', q.reference_answer,
      -- Their own words, so the list is readable without opening anything.
      'response', a.response,
      'score', a.normalized_score,
      'answered_at', a.created_at
    ) AS x
    FROM answer_attempts a
    JOIN quiz_run_items ri ON ri.id = a.quiz_run_item_id
    JOIN quiz_questions q  ON q.id  = ri.question_id
    LEFT JOIN cards c ON c.id = a.card_id
    LEFT JOIN decks d ON d.id = c.deck_id
    WHERE a.user_id = v_uid
      AND a.quiz_run_item_id IS NOT NULL
      AND a.normalized_score IS NOT NULL
      AND a.normalized_score < 0.75
      AND (p_deck_id IS NULL OR c.deck_id = p_deck_id)
    ORDER BY a.created_at DESC
    LIMIT p_limit
  ) s;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_mistakes(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_mistakes(uuid, integer) TO authenticated;

-- The badge. Same definition of a miss, counted per deck or across everything, and DISTINCT on
-- the card: a card missed four times is one card to restudy, not four.
CREATE OR REPLACE FUNCTION public.count_quiz_mistakes(p_deck_id uuid DEFAULT NULL)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(DISTINCT COALESCE(a.card_id, a.id))::integer
  FROM answer_attempts a
  LEFT JOIN cards c ON c.id = a.card_id
  WHERE a.user_id = auth.uid()
    AND a.quiz_run_item_id IS NOT NULL
    AND a.normalized_score IS NOT NULL
    AND a.normalized_score < 0.75
    AND (p_deck_id IS NULL OR c.deck_id = p_deck_id);
$$;
REVOKE EXECUTE ON FUNCTION public.count_quiz_mistakes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_quiz_mistakes(uuid) TO authenticated;

COMMIT;
