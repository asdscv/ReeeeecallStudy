-- Fix: prev_srs_status was never written due to PostgREST PGRST204 schema cache issue.
-- Using SECURITY DEFINER RPC bypasses the schema cache entirely.
-- Includes auth.uid() validation to prevent cross-user data injection.

CREATE OR REPLACE FUNCTION insert_study_log(
  p_user_id UUID,
  p_card_id UUID,
  p_deck_id UUID,
  p_study_mode TEXT,
  p_rating TEXT,
  p_prev_interval INTEGER DEFAULT NULL,
  p_new_interval INTEGER DEFAULT NULL,
  p_prev_ease REAL DEFAULT NULL,
  p_new_ease REAL DEFAULT NULL,
  p_review_duration_ms INTEGER DEFAULT NULL,
  p_prev_srs_status TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is inserting for themselves only
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: cannot insert study logs for other users';
  END IF;

  -- Verify card belongs to the specified deck
  IF NOT EXISTS (
    SELECT 1 FROM cards WHERE id = p_card_id AND deck_id = p_deck_id
  ) THEN
    RAISE EXCEPTION 'Card does not belong to specified deck';
  END IF;

  INSERT INTO study_logs (
    user_id, card_id, deck_id, study_mode, rating,
    prev_interval, new_interval, prev_ease, new_ease,
    review_duration_ms, prev_srs_status
  )
  VALUES (
    p_user_id, p_card_id, p_deck_id, p_study_mode, p_rating,
    p_prev_interval, p_new_interval, p_prev_ease, p_new_ease,
    p_review_duration_ms, p_prev_srs_status
  );
END;
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION insert_study_log(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, REAL, REAL, INTEGER, TEXT) TO authenticated;
