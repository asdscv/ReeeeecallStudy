-- Rollback for 184. Restores 183's `cards`-only mastery count and drops the resolver.
-- Deliberately re-creates the old body rather than leaving a caller pointed at a dropped
-- function, which would take achievements down.
BEGIN;

CREATE OR REPLACE FUNCTION public.mature_card_count(p_user_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = public
AS $$
  SELECT count(*) FROM cards
  WHERE user_id = p_user_id
    AND srs_status = 'review'
    AND interval_days >= 21;
$$;

DROP FUNCTION IF EXISTS public.learner_card_schedule(uuid);

COMMIT;
