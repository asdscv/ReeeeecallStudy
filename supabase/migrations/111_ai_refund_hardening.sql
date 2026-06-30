-- ============================================================================
-- 111: Harden AI refunds (security — self-credit hole in 109/110).
--
-- mig 109/110 exposed refund_ai_generation / refund_ai_image to `authenticated`
-- with a CLIENT-SUPPLIED amount crediting the caller's own wallet → any logged-in
-- user could mint unlimited credits via PostgREST. Fix:
--   * record_ai_generation / record_ai_image now write a JOB ROW (the exact
--     reservation) and return its job_ref.
--   * refund is keyed on that job_ref, derives the amount from the recorded row
--     (never from a client arg), is idempotent (refunded flag + ledger ref), and
--     is **service_role / admin only** — the edge fn refunds with a service-role
--     client (record stays as the user; only refund is privileged).
--   * the old client-callable refunds are dropped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_generation_jobs (
  id         text        NOT NULL PRIMARY KEY,   -- job_ref (uuid text)
  user_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  usage_date date        NOT NULL,
  free_cards integer     NOT NULL DEFAULT 0,
  paid_cards integer     NOT NULL DEFAULT 0,
  credits    integer     NOT NULL DEFAULT 0,
  image_jobs integer     NOT NULL DEFAULT 0,
  refunded   boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_generation_jobs ENABLE ROW LEVEL SECURITY;  -- deny-all; RPC-only
CREATE INDEX IF NOT EXISTS ai_generation_jobs_user ON public.ai_generation_jobs (user_id, created_at DESC);

-- record_ai_generation: + writes a job row, + returns job_ref (else unchanged).
CREATE OR REPLACE FUNCTION public.record_ai_generation(p_kind text, p_cards integer DEFAULT 0)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_used  integer;
  v_reqs  integer;
  v_free_now integer;
  v_paid_now integer;
  v_need  integer;
  v_bal   integer;
  v_ref   text    := gen_random_uuid()::text;
  c_free constant integer := public._ai_free_cards_per_day();
  c_cpc  constant integer := public._ai_credits_per_card();
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_kind NOT IN ('cards', 'template', 'deck') THEN
    RAISE EXCEPTION 'Invalid generation kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_cards IS NULL OR p_cards < 0 THEN p_cards := 0; END IF;
  IF p_kind <> 'cards' THEN p_cards := 0; END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT free_cards_used, req_count INTO v_used, v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;

  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  v_free_now := LEAST(p_cards, GREATEST(0, c_free - v_used));
  v_paid_now := p_cards - v_free_now;
  v_need     := v_paid_now * c_cpc;

  IF v_need > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_need, updated_at = now()
      WHERE user_id = v_uid AND balance >= v_need RETURNING balance INTO v_bal;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient AI credits' USING errcode = 'P0002'; END IF;
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (v_uid, -v_need, 'spend_cards', v_ref, v_bal);
  END IF;

  UPDATE ai_generation_usage
     SET free_cards_used = free_cards_used + v_free_now,
         paid_cards_used = paid_cards_used + v_paid_now,
         req_count       = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, credits, image_jobs)
    VALUES (v_ref, v_uid, v_today, v_free_now, v_paid_now, v_need, 0);

  RETURN jsonb_build_object(
    'remaining_free', GREATEST(0, c_free - (v_used + v_free_now)),
    'free_now', v_free_now, 'paid_now', v_paid_now, 'credits_spent', v_need,
    'job_ref', v_ref
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_ai_generation(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_ai_generation(text, integer) TO authenticated;

-- record_ai_image: + writes a job row, + returns job_ref.
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
  v_ref   text    := gen_random_uuid()::text;
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  UPDATE ai_credit_balance SET balance = balance - v_need, updated_at = now()
    WHERE user_id = v_uid AND balance >= v_need RETURNING balance INTO v_bal;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient AI credits' USING errcode = 'P0002'; END IF;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_uid, -v_need, 'spend_image', v_ref, v_bal);

  UPDATE ai_generation_usage SET image_jobs = image_jobs + 1, req_count = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, credits, image_jobs)
    VALUES (v_ref, v_uid, v_today, 0, 0, v_need, 1);

  RETURN jsonb_build_object('credits_spent', v_need, 'balance', v_bal, 'job_ref', v_ref);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_ai_image() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_ai_image() TO authenticated;

-- Drop the client-callable refund holes from 109/110. Idempotent DROPs so this
-- ALSO closes the function on any dev/preview DB that applied an earlier form of
-- 110 (which created refund_ai_image GRANTed to authenticated).
DROP FUNCTION IF EXISTS public.refund_ai_generation(integer, integer, integer);
DROP FUNCTION IF EXISTS public.refund_ai_image(integer);

-- Safe refund: keyed on a recorded job, amount DERIVED from the row (never the
-- client), idempotent, service_role/admin only. The edge fn calls this with a
-- service-role client + explicit p_user_id (auth.uid() is NULL under service_role).
CREATE OR REPLACE FUNCTION public.refund_ai_job(p_user_id uuid, p_job_ref text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.ai_generation_jobs; v_bal integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to refund' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;

  SELECT * INTO j FROM ai_generation_jobs
    WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.refunded THEN RETURN; END IF;  -- unknown / already refunded → no-op

  UPDATE ai_generation_usage
     SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
         paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
         image_jobs      = GREATEST(0, image_jobs - j.image_jobs)
   WHERE user_id = p_user_id AND usage_date = j.usage_date;

  IF j.credits > 0 THEN
    UPDATE ai_credit_balance SET balance = balance + j.credits, updated_at = now()
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, j.credits, 'refund', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refund_ai_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_ai_job(uuid, text) TO service_role;
