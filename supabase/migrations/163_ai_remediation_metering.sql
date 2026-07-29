-- 163: paid AI remediation metering and service-only enrichment persistence.
-- Additive extension of the existing reserve -> generate -> charge/release pipeline.
BEGIN;

ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS job_kind text NOT NULL DEFAULT 'legacy_generation',
  ADD COLUMN IF NOT EXISTS billable_fraction numeric(5,4) NOT NULL DEFAULT 0;

ALTER TABLE public.ai_generation_jobs
  DROP CONSTRAINT IF EXISTS ai_generation_jobs_job_kind_check,
  DROP CONSTRAINT IF EXISTS ai_generation_jobs_billable_fraction_check;
ALTER TABLE public.ai_generation_jobs
  ADD CONSTRAINT ai_generation_jobs_job_kind_check
    CHECK (job_kind IN ('legacy_generation','cards','template','deck','image','remediation')),
  ADD CONSTRAINT ai_generation_jobs_billable_fraction_check
    CHECK (billable_fraction >= 0 AND billable_fraction <= 1);

COMMENT ON COLUMN public.ai_generation_jobs.job_kind IS
  'Billing/observability classification. remediation is isolated from legacy generation quotas.';
COMMENT ON COLUMN public.ai_generation_jobs.billable_fraction IS
  'Fraction of actual provider cost eligible for markup charging; remediation is always 1.0.';

CREATE OR REPLACE FUNCTION public.reserve_ai_remediation(
  p_action text,
  p_goal_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL,
  p_card_ids uuid[] DEFAULT '{}'::uuid[],
  p_concept_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_ref text := gen_random_uuid()::text;
  v_balance bigint;
  v_requests integer;
  v_id uuid;
  c_max_requests constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend') THEN
    RAISE EXCEPTION 'Invalid remediation action' USING errcode = 'invalid_parameter_value';
  END IF;
  IF cardinality(COALESCE(p_card_ids, '{}'::uuid[])) > 50
     OR cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) > 50 THEN
    RAISE EXCEPTION 'Too many remediation references' USING errcode = 'check_violation';
  END IF;
  IF p_goal_id IS NULL AND p_activity_id IS NULL AND p_attempt_id IS NULL
     AND cardinality(COALESCE(p_card_ids, '{}'::uuid[])) = 0
     AND cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'Remediation requires a structured learning reference' USING errcode = 'invalid_parameter_value';
  END IF;

  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
  ) THEN RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501'; END IF;

  IF p_activity_id IS NOT NULL AND NOT public._check_activity_access(v_uid, p_activity_id) THEN
    RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501';
  END IF;

  IF p_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM answer_attempts WHERE id = p_attempt_id AND user_id = v_uid
  ) THEN RAISE EXCEPTION 'Attempt not accessible' USING errcode = '42501'; END IF;

  FOREACH v_id IN ARRAY COALESCE(p_card_ids, '{}'::uuid[]) LOOP
    IF NOT public._check_card_access(v_uid, v_id) THEN
      RAISE EXCEPTION 'Card not accessible' USING errcode = '42501';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_concept_ids, '{}'::uuid[])) requested(id)
    LEFT JOIN learning_concepts c ON c.id = requested.id
    WHERE c.id IS NULL OR NOT (
      c.owner_user_id = v_uid OR (
        c.owner_user_id IS NULL AND (
          p_goal_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM learning_goal_concepts gc
            WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
          )
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  SELECT balance INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  IF COALESCE(v_balance, 0) <= 0 THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_requests FROM ai_generation_usage
    WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;
  UPDATE ai_generation_usage SET req_count = req_count + 1
    WHERE user_id = v_uid AND usage_date = v_today;

  -- paid_cards=1 keeps the existing actual-cost charge function's paid_share at 1.
  INSERT INTO ai_generation_jobs
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction)
  VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 1.0);

  RETURN jsonb_build_object('job_ref', v_ref, 'billable_fraction', 1.0, 'job_kind', 'remediation');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.persist_ai_remediation(
  p_user_id uuid,
  p_action text,
  p_content jsonb,
  p_source_refs uuid[] DEFAULT '{}'::uuid[],
  p_goal_id uuid DEFAULT NULL,
  p_concept_id uuid DEFAULT NULL,
  p_card_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_request_fingerprint text DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_prompt_version text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend')
     OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
     OR octet_length(p_content::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid remediation payload' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals
    WHERE id = p_goal_id AND user_id = p_user_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Goal ownership mismatch' USING errcode = '42501';
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_activities
    WHERE id = p_activity_id AND (owner_user_id = p_user_id OR owner_user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501'; END IF;
  IF p_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cards c JOIN decks d ON d.id = c.deck_id
    WHERE c.id = p_card_id AND c.user_id = d.user_id AND (
      (d.user_id = p_user_id AND (
        public.get_active_card_threshold() IS NULL
        OR c.created_at <= public.get_active_card_threshold()
        OR (EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
            AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false))
      ))
      OR (EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.deck_id = d.id AND ds.recipient_id = p_user_id
          AND ds.share_mode = 'subscribe' AND ds.status = 'active'
      ) AND public.is_subscribed_deck_active(d.id))
    )
  ) THEN RAISE EXCEPTION 'Card not accessible' USING errcode = '42501'; END IF;
  IF p_concept_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_concepts c
    WHERE c.id = p_concept_id AND (
      c.owner_user_id = p_user_id OR (
        c.owner_user_id IS NULL AND p_goal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM learning_goal_concepts gc
          WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  INSERT INTO user_enrichments
    (user_id, goal_id, concept_id, card_id, activity_id, action, request_fingerprint,
     content, source_references, model_version, provider, prompt_version, status)
  VALUES
    (p_user_id, p_goal_id, p_concept_id, p_card_id, p_activity_id, p_action,
     NULLIF(left(COALESCE(p_request_fingerprint, ''), 128), ''), p_content,
     to_jsonb(COALESCE(p_source_refs, '{}'::uuid[])), left(p_model_version, 200), left(p_provider, 100),
     left(p_prompt_version, 100), 'preview')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persist_ai_remediation(uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_ai_remediation(uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text)
  TO service_role;

-- Failure release must not decrement legacy card/image counters for remediation jobs.
CREATE OR REPLACE FUNCTION public.release_ai_job(p_user_id uuid, p_job_ref text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE j public.ai_generation_jobs%ROWTYPE;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to release' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;
  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.refunded OR j.charged THEN RETURN; END IF;
  IF j.job_kind <> 'remediation' THEN
    UPDATE ai_generation_usage
       SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
           paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
           image_jobs = GREATEST(0, image_jobs - j.image_jobs)
     WHERE user_id = p_user_id AND usage_date = j.usage_date;
  END IF;
  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_ai_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_job(uuid, text) TO service_role;

COMMIT;
