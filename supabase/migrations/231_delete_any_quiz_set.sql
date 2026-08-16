-- 231: a quiz set can be deleted even after it has been taken.
--
-- 224 refused (P0014) once a set had any run, and the reason was real: the cascade reaches the
-- learner's own answers.
--
--     quiz_sets -> quiz_questions                        CASCADE
--     quiz_sets -> quiz_runs -> quiz_run_items           CASCADE
--     quiz_run_items -> answer_attempts                  CASCADE   (mig 193:243)
--
-- Verified empirically, not read off the migration text: inserting a full chain and deleting the
-- set destroys the `answer_attempts` row. What the learner loses with it:
--
--   get_quiz_mistakes / count_quiz_mistakes   those misses leave the 오답 노트 for good
--   learning insights and the planner         the goal-scoped attempt rows behind 취약 카드
--   check_achievements                        the `quizzes` and `graded` counters, and the
--                                             evidence for perfect_quiz and comeback. Badges
--                                             already earned are NOT revoked, so the loss is
--                                             asymmetric: the count drops, the badge stays.
--   get_ai_activity                           the sittings vanish; the grading CHARGES remain,
--                                             which is the honest half to keep
--
-- The owner asked for it anyway, and it is their data. So the refusal goes and the warning moves
-- to where it belongs: the client asks first, and says what will be lost. A confirm the learner
-- reads beats an error they cannot get past.
--
-- The ownership check, the idempotent no-op and the SECURITY DEFINER search_path are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_quiz_set(p_set_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT owner_user_id INTO v_owner FROM quiz_sets WHERE id = p_set_id;
  -- Already gone is the outcome the caller wanted. Saying so beats an error a screen has to
  -- special-case on a double tap.
  IF v_owner IS NULL THEN RETURN false; END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501';
  END IF;

  -- No run check. The cascade takes the sittings and the answers under them, which is what the
  -- learner is agreeing to when they confirm.
  DELETE FROM quiz_sets WHERE id = p_set_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_quiz_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quiz_set(uuid) TO authenticated;

COMMIT;
