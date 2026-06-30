-- ============================================================================
-- 110: AI image-recognition metering (server-gen Phase 1b).
--
-- "Upload an image → recognize it → generate cards" is ALWAYS paid (no free
-- tier — vision is the expensive path). Each job debits a flat credit cost and
-- bumps image_jobs (mig 108 column). Reuses the wallet from mig 109.
-- ============================================================================

-- Credits charged per image-recognition job (config seam).
CREATE OR REPLACE FUNCTION public._ai_credits_per_image()
  RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 5 $$;
REVOKE EXECUTE ON FUNCTION public._ai_credits_per_image() FROM PUBLIC, anon, authenticated;

-- Meter one image job: debit credits (insufficient → P0002 RAISE → rolls back),
-- bump image_jobs + req_count, ledger 'spend_image'. Returns jsonb
-- {credits_spent, balance} so a failed vision call can be refunded.
CREATE OR REPLACE FUNCTION public.record_ai_image()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_need  integer := public._ai_credits_per_image();
  v_reqs  integer;
  v_bal   integer;
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  UPDATE ai_credit_balance SET balance = balance - v_need, updated_at = now()
    WHERE user_id = v_uid AND balance >= v_need
    RETURNING balance INTO v_bal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient AI credits' USING errcode = 'P0002';
  END IF;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_uid, -v_need, 'spend_image', NULL, v_bal);

  UPDATE ai_generation_usage
     SET image_jobs = image_jobs + 1, req_count = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  RETURN jsonb_build_object('credits_spent', v_need, 'balance', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_ai_image() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_ai_image() TO authenticated;

-- Refund for image jobs is handled by refund_ai_job (mig 111) — service_role
-- only, derives the amount from a recorded job row (no client-supplied amount).

-- Extend the wallet snapshot with the image price (was: balance, credits_per_card).
DROP FUNCTION IF EXISTS public.get_ai_wallet();
CREATE FUNCTION public.get_ai_wallet()
  RETURNS TABLE (balance integer, credits_per_card integer, credits_per_image integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY SELECT
    COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    public._ai_credits_per_card(),
    public._ai_credits_per_image();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_wallet() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet() TO authenticated;
