-- 237: deleting a quiz that had been taken still failed, in a way 231 could not have predicted.
--
-- 231 removed the refusal so an owner could delete a set they had already sat. Measured today, on
-- production, deleting 28 sets: 23 went, 5 came back
--
--     23503  insert or update on table "quiz_run_items" violates foreign key
--            constraint "quiz_run_items_run_id_fkey"
--     DETAIL Key (run_id)=(8d24f0ed-...) is not present in table "quiz_runs".
--
-- An INSERT-OR-UPDATE error, from a DELETE. The cause is two referential actions on the same
-- table pulling in opposite directions:
--
--     quiz_run_items.run_id      -> quiz_runs(id)       ON DELETE CASCADE
--     quiz_run_items.question_id -> quiz_questions(id)  ON DELETE SET NULL
--
-- Deleting the set cascades to BOTH parents. If the question side fires first, Postgres UPDATEs
-- `quiz_run_items.question_id = NULL` on rows whose run has already been cascade-deleted — and
-- an UPDATE re-checks that row's other foreign keys, including `run_id`, which now points at
-- nothing. Whether it happens depends on the order the two cascades are visited in, which is why
-- it hit 5 of 28 rather than all of them: only sets with BOTH runs and surviving questions can
-- trip it.
--
-- Neither constraint is wrong. `SET NULL` is deliberate — a question can be removed while the
-- learner's answer to it stays in their history — and `CASCADE` on the run is what makes deleting
-- a set possible at all. What is wrong is leaving the ORDER to chance when the caller knows it.
--
-- So the runs go first, explicitly. That takes `quiz_run_items` (and `answer_attempts` under it)
-- with them, and by the time the set is deleted there is no run item left for the question
-- cascade to update.
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

  -- ORDER MATTERS. See the note above: the runs must be gone before the questions are, or the
  -- question cascade's `SET NULL` lands on run items whose run has just been deleted and the
  -- statement fails with a foreign key violation on the way out.
  DELETE FROM quiz_runs WHERE set_id = p_set_id;
  DELETE FROM quiz_sets WHERE id = p_set_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_quiz_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quiz_set(uuid) TO authenticated;

COMMIT;
