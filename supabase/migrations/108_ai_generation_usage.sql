-- ============================================================================
-- 108: Per-account AI generation metering (server-side generation — Phase 0).
--
-- Moves AI flashcard generation from client-side BYOK (each user's own API key)
-- to a SERVER-owned key behind the `ai-generate` edge function. To bound our
-- provider cost, every generation is metered per user per UTC day:
--   * Free tier : 10 generated CARDS / day / account (text generation).
--   * template/deck generation : NOT card-metered, but bounded by a daily
--     request cap (abuse protection) — decks aren't the costly part, cards are.
--
-- Phase 0 has NO payment: the free card quota is a HARD ceiling (RAISE -> 429).
-- Phase 1 adds a prepaid wallet; `paid_cards_used` / `image_jobs` and the
-- over-free branch in record_ai_generation() are the seams it extends.
--
-- Mirrors the tts_usage metering (migration 101): deny-all table, SECURITY
-- DEFINER UPSERT keyed on auth.uid(); a RAISE rolls back the increment so a
-- rejected call consumes nothing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_generation_usage (
  user_id         uuid    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  usage_date      date    NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  free_cards_used integer NOT NULL DEFAULT 0,   -- cards counted against the daily free quota
  paid_cards_used integer NOT NULL DEFAULT 0,   -- Phase 1 (wallet); always 0 in Phase 0
  image_jobs      integer NOT NULL DEFAULT 0,   -- Phase 1 (image-recognition jobs)
  req_count       integer NOT NULL DEFAULT 0,   -- all generation requests (abuse cap)
  PRIMARY KEY (user_id, usage_date)
);

-- RLS on with NO policies → deny-all to anon/authenticated via PostgREST; only
-- the SECURITY DEFINER RPCs below ever touch the table.
ALTER TABLE public.ai_generation_usage ENABLE ROW LEVEL SECURITY;

-- Single source of truth for the daily free card quota (Phase-1 config seam).
-- Internal helper — definer functions below call it regardless of grants.
CREATE OR REPLACE FUNCTION public._ai_free_cards_per_day()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public
AS $$ SELECT 10 $$;

REVOKE EXECUTE ON FUNCTION public._ai_free_cards_per_day() FROM PUBLIC, anon, authenticated;

-- Meter one generation event for the current user and enforce the daily budget.
--   p_kind  : 'cards' | 'template' | 'deck'
--   p_cards : number of cards in this call (only counts when p_kind = 'cards')
-- Returns remaining free cards for today (post-increment). RAISEs (→ caller
-- returns 429) when the free card quota or the request cap is exceeded; the
-- RAISE rolls back the increment so a rejected call consumes nothing.
CREATE OR REPLACE FUNCTION public.record_ai_generation(p_kind text, p_cards integer DEFAULT 0)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_free  integer;
  v_reqs  integer;
  c_free_cards constant integer := public._ai_free_cards_per_day();
  c_max_reqs   constant integer := 300;  -- daily generation-request cap (abuse, tunable)
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_kind NOT IN ('cards', 'template', 'deck') THEN
    RAISE EXCEPTION 'Invalid generation kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_cards IS NULL OR p_cards < 0 THEN
    p_cards := 0;
  END IF;
  -- Only card generation consumes the card quota; template/deck are req-capped only.
  IF p_kind <> 'cards' THEN
    p_cards := 0;
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date, free_cards_used, req_count)
  VALUES (v_uid, v_today, p_cards, 1)
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET free_cards_used = ai_generation_usage.free_cards_used + EXCLUDED.free_cards_used,
        req_count       = ai_generation_usage.req_count + 1
  RETURNING free_cards_used, req_count INTO v_free, v_reqs;

  IF v_reqs > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  -- Phase 0: no wallet yet → the free card quota is a hard ceiling.
  IF p_kind = 'cards' AND v_free > c_free_cards THEN
    RAISE EXCEPTION 'AI free card quota exceeded' USING errcode = 'check_violation';
  END IF;

  RETURN GREATEST(0, c_free_cards - v_free);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ai_generation(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_ai_generation(text, integer) TO authenticated;

-- Read-only quota snapshot for the client (cap the card-count selector + show
-- "N free left today"). No side effects.
CREATE OR REPLACE FUNCTION public.get_ai_generation_quota()
  RETURNS TABLE (free_limit integer, free_used integer, remaining integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_used  integer;
  c_free_cards constant integer := public._ai_free_cards_per_day();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT free_cards_used INTO v_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_used := COALESCE(v_used, 0);
  RETURN QUERY SELECT c_free_cards, v_used, GREATEST(0, c_free_cards - v_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ai_generation_quota() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_generation_quota() TO authenticated;
