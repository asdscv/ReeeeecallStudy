-- 224: 17 of 49 quiz sets on production have zero questions, and nobody can get rid of them.
--
-- A set is created before generation runs, so a generation that produces nothing leaves the row
-- behind. It cannot be taken — the button is disabled at `generated_count = 0` — and there was no
-- way to remove it, so a third of the quiz home was dead rows the learner could neither use nor
-- clear. Nothing was charged for them either, which is what makes them pure noise: they are the
-- residue of a failure the learner already saw an error for.
--
-- The rule is NEVER RUN, not "empty".
--
-- `quiz_questions`, `quiz_runs` and `quiz_run_items` all cascade from a set, and `answer_attempts`
-- cascades from a run item — so deleting a set the learner has actually sat destroys every answer
-- they gave it, and with it their 오답 노트 entries for those cards. The owner asked for the set
-- list precisely so the history stays reachable ("나중에 내역도 확인 필요하니까"). A set with a
-- run is history; a set without one is a row nobody has ever seen the inside of.
--
-- That is stricter than the reported problem needs and it covers all of it: every one of the 17
-- has no questions, so none of them can have been run.
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

  -- The one refusal. A run means answers, and answers cascade.
  IF EXISTS (SELECT 1 FROM quiz_runs WHERE set_id = p_set_id) THEN
    RAISE EXCEPTION 'Quiz set has been taken and keeps its history' USING errcode = 'P0014';
  END IF;

  DELETE FROM quiz_sets WHERE id = p_set_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_quiz_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quiz_set(uuid) TO authenticated;

COMMIT;
