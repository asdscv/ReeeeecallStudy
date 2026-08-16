-- Rollback 231: a set that has been taken becomes undeletable again.
--
-- Restores 224's P0014 refusal. Sets already deleted under 231 stay deleted — the cascade has
-- run and there is nothing to bring back.
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
