-- ============================================================================
-- 203: two things live verification found
--
-- ── 1. `meta.flaws` was misaligned with the options actually served ─────────
--
-- `quiz_questions.options` is stored in canonical order with `correct_index` marking
-- the answer, and `meta.flaws` is parallel to it — null at the correct slot.
-- `get_quiz_run_items` then permutes `options` through the sitting's `option_order`
-- and returns `meta` UNCHANGED.
--
-- So the served payload asserts two different correct answers. Measured on a real run:
-- 4 of 6 items had `meta.flaws`'s null at a different index than `reference_answer`'s
-- position in `options` — e.g. answer 렌치 served at index 3, null flaw at index 1.
--
-- No learner sees it today: nothing renders `flaws`. But the entire reason flaws are
-- stored is the post-answer "why was each option wrong" explanation, and shipping that
-- on top of this would attach every explanation to the wrong option. Fixing it now
-- costs one array walk; fixing it later costs a wrong explanation in production.
--
-- ── 2. Band 1's multiple-choice instruction was ignored, every time ─────────
--
-- Band 1 asks for wrong options from a DIFFERENT semantic category. On a ten-card
-- multi-domain deck it produced, for `wrench` → 망치 · 톱 · 드라이버 (three other hand
-- tools), and for `ferment` → 냉동시키다 · 살균하다 · 요리하다 (three other cooking
-- verbs). Both items scored near=3 against a band whose ceiling is 0.
--
-- The result is that band 1 is not easier than band 2 — on the evidence it is HARDER,
-- which is the opposite of what a learner picking "쉬움" is promised.
--
-- Two changes, both data:
--
--   * `allowed_flaws` is set to the FAR set. The prompt builder already filters the flaw
--     menu it offers down to `allowed_flaws` (ai-quiz-prompts.ts, `permitted`), so the
--     near labels stop being options the model can pick — a far stronger instruction than
--     asking it not to pick them. Band 1 had `allowed_flaws = '{}'`, which means "no
--     restriction", so it was being handed the full menu including every near label.
--   * The guidance leads with a worked example in the card's own terms, because "a
--     different semantic category" is abstract and "if the answer is a tool, do NOT use
--     other tools" is not.
--
-- Neither needed a deploy — that is the point of bands being rows. This migration exists
-- so a database built from scratch gets the same values, not because production waited
-- for it.
-- ============================================================================

BEGIN;

-- ── 1) Serve `meta` in the same order as the options ────────────────────────
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
    'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) TO authenticated;

-- ── 2) Band 1 stops being offered the near labels at all ────────────────────
UPDATE public.quiz_difficulty_levels
   SET allowed_flaws = ARRAY['unrelated', 'right_category_wrong_item', 'overgeneral'],
       guidance = guidance || jsonb_build_object('mcq',
         'EASY. Work out what KIND of thing the answer is, then take every wrong option from a DIFFERENT kind. '
         || 'If the answer is a tool, do NOT use other tools — use an emotion, a place, a time. '
         || 'If the answer is an action, do NOT use other actions — use concrete objects. '
         || 'If the answer is a colour, do NOT use other colours — use animals or buildings. '
         || 'Name the category you moved to for each option. A learner who knows only what KIND of thing the answer is must be able to rule out all three. '
         || 'Near-synonyms, opposites and anything from the answer''s own topic are WRONG for this band.')
 WHERE level = 1;

COMMIT;
