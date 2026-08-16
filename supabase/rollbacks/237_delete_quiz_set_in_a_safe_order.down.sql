-- Down for 237: back to the single DELETE that leaves the cascade order to chance.
--
-- Reinstates 231's body exactly. Deleting a set that has both runs and questions may fail with
-- 23503 again — which is the state this rolls back to, not a new fault.
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_quiz_set(p_set_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT owner_user_id INTO v_owner FROM quiz_sets WHERE id = p_set_id;
  IF v_owner IS NULL THEN RETURN false; END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501';
  END IF;

  DELETE FROM quiz_sets WHERE id = p_set_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_quiz_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quiz_set(uuid) TO authenticated;

COMMIT;
