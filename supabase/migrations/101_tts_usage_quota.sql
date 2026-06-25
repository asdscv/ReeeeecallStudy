-- ============================================================================
-- 101: Per-user daily TTS quota (security audit H3 — cost-abuse protection).
--
-- The TTS edge function (supabase/functions/tts) had NO rate limit/quota, so an
-- auto-confirmed throwaway account could loop unbounded synthesis requests →
-- unbounded Edge cost/egress + hammering the upstream Microsoft TTS endpoint.
-- This adds a per-user, per-UTC-day counter enforced by a SECURITY DEFINER RPC
-- the edge function calls before each synthesis. Limits are generous (cover a
-- heavy study session) but bound abuse to a finite per-account daily budget.
-- Tunable via the two constants below.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tts_usage (
  user_id    uuid    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  usage_date date    NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  char_count integer NOT NULL DEFAULT 0,
  req_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

-- RLS on with NO policies → deny-all to anon/authenticated via PostgREST; only
-- the SECURITY DEFINER RPC below ever touches the table.
ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;

-- Record one TTS request of p_chars characters for the current user and enforce
-- the daily budget. Raises (→ caller returns 429) when the cap is exceeded.
CREATE OR REPLACE FUNCTION public.record_tts_usage(p_chars integer)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_chars integer;
  v_reqs  integer;
  c_max_chars constant integer := 400000;  -- per-user/day character budget (tunable)
  c_max_reqs  constant integer := 2000;    -- per-user/day request cap (tunable)
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_chars IS NULL OR p_chars < 0 THEN
    p_chars := 0;
  END IF;

  INSERT INTO tts_usage (user_id, usage_date, char_count, req_count)
  VALUES (v_uid, v_today, p_chars, 1)
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET char_count = tts_usage.char_count + EXCLUDED.char_count,
        req_count  = tts_usage.req_count + 1
  RETURNING char_count, req_count INTO v_chars, v_reqs;

  IF v_chars > c_max_chars OR v_reqs > c_max_reqs THEN
    RAISE EXCEPTION 'TTS daily quota exceeded' USING errcode = 'check_violation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_tts_usage(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tts_usage(integer) TO authenticated;
