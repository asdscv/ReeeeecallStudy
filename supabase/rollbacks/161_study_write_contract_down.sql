-- 161 rollback. Restoring these grants RE-OPENS the direct write paths that let a
-- client bypass revision checks and server-side aggregation, so production should
-- prefer a forward fix. Use this only to unblock a local/staging environment.

-- Re-open the direct write paths.
GRANT UPDATE ON TABLE public.cards TO authenticated;
GRANT UPDATE ON TABLE public.user_card_progress TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.study_logs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.study_sessions TO authenticated;
GRANT UPDATE ON TABLE public.deck_study_state TO authenticated;

-- Restore the superseded log RPC (body copied from migration 078).
CREATE OR REPLACE FUNCTION public.insert_study_log(
  p_user_id uuid,
  p_card_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_rating text,
  p_prev_interval integer,
  p_new_interval integer,
  p_prev_ease real,
  p_new_ease real,
  p_review_duration_ms integer,
  p_prev_srs_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO study_logs (
    user_id, card_id, deck_id, study_mode, rating,
    prev_interval, new_interval, prev_ease, new_ease,
    review_duration_ms, prev_srs_status
  ) VALUES (
    p_user_id, p_card_id, p_deck_id, p_study_mode, p_rating,
    p_prev_interval, p_new_interval, p_prev_ease, p_new_ease,
    p_review_duration_ms, p_prev_srs_status
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.insert_study_log(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_study_log(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text)
  TO authenticated;

-- Remove the contract-phase functions.
REVOKE EXECUTE ON FUNCTION public.reset_card_srs(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.reset_card_srs(uuid);
DROP FUNCTION IF EXISTS public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb);
-- Restoring the pre-161 signature requires re-running migration 160's definition of
-- finalize_study_session (six arguments). Apply 160 after this script, or restore the
-- function from that migration file, before pointing a P5B client at the database.
