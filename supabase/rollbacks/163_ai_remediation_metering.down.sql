-- Rollback 163. Enrichment rows are retained; only the new execution contract is removed.
BEGIN;
DROP FUNCTION IF EXISTS public.persist_ai_remediation(uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[]);

-- Restore the legacy release implementation before removing job_kind.
CREATE OR REPLACE FUNCTION public.release_ai_job(p_user_id uuid, p_job_ref text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.ai_generation_jobs%ROWTYPE;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to release' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;
  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.refunded OR j.charged THEN RETURN; END IF;
  UPDATE ai_generation_usage
     SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
         paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
         image_jobs = GREATEST(0, image_jobs - j.image_jobs)
   WHERE user_id = p_user_id AND usage_date = j.usage_date;
  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_ai_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_job(uuid, text) TO service_role;

ALTER TABLE public.ai_generation_jobs DROP CONSTRAINT IF EXISTS ai_generation_jobs_job_kind_check;
ALTER TABLE public.ai_generation_jobs DROP CONSTRAINT IF EXISTS ai_generation_jobs_billable_fraction_check;
ALTER TABLE public.ai_generation_jobs DROP COLUMN IF EXISTS job_kind;
ALTER TABLE public.ai_generation_jobs DROP COLUMN IF EXISTS billable_fraction;
COMMIT;
