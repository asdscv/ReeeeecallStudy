-- 212: a paid explanation is bought once.
--
-- `reserve_ai_remediation` minted a fresh `gen_random_uuid()` on every call and looked at
-- nothing that had come before it. The learner-visible consequence: the answer lives only in
-- the store, so pressing 닫기 — which says "close", not "delete" — or reloading the page, or
-- re-rating the card, drops it. The only route back to a paragraph they already paid for is the
-- same paid button, which generates it again, from byte-identical grounding, and charges again.
-- Two 'spend' rows for one artifact.
--
-- The same gap made "charged and got nothing" permanent rather than merely unlucky: when the
-- 200 is lost in transit after `charge_ai_generation` commits, the answer is already sitting in
-- `user_enrichments`, and nothing in the app has ever read that table.
--
-- Two guards, because they fail in different ways:
--
--   * REPLAY — an explanation already stored for this (user, attempt, action) is returned as-is,
--     free. An attempt is one immutable event, so the grounding cannot have changed; a second
--     generation could only produce a differently-worded answer to an identical question. When
--     the learner misses the card AGAIN that is a new attempt id, and that one is charged.
--
--   * IN FLIGHT — a remediation job for the same attempt that is neither charged nor refunded
--     is a request whose model call has not come back yet. Replay cannot see it (nothing is
--     persisted until the model answers, ~8s later), so without this a second press inside that
--     window is a second charge. Bounded to two minutes so a crashed function that never
--     released its job cannot lock the learner out of the feature.
--
-- Deliberately NOT built on `client_ref`'s unique index, the way quiz idempotency is: a hard
-- unique key collides with `release_ai_job`, which marks a failed job refunded but leaves the
-- row in place — a learner whose first attempt failed would then be permanently unable to retry.
-- That is a worse bug than the one being fixed.
BEGIN;

ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS remediation_attempt_id uuid;

COMMENT ON COLUMN public.ai_generation_jobs.remediation_attempt_id IS
  'Attempt a remediation job is grounded in. Lets reserve_ai_remediation see a request whose '
  'model call is still outstanding, which user_enrichments cannot show until it returns.';

-- Partial: only remediation rows carry it, and this index is only ever probed for them.
CREATE INDEX IF NOT EXISTS ai_generation_jobs_remediation_attempt
  ON public.ai_generation_jobs (user_id, remediation_attempt_id)
  WHERE remediation_attempt_id IS NOT NULL;

-- Replay reads by (user, attempt, action); without this it is a scan of the learner's history.
CREATE INDEX IF NOT EXISTS user_enrichments_attempt_action
  ON public.user_enrichments (user_id, attempt_id, action)
  WHERE attempt_id IS NOT NULL;

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
  v_existing_id uuid;
  v_existing_content jsonb;
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

  -- ── Bought already? ────────────────────────────────────────────────────────
  --
  -- After the ownership checks, so a caller cannot probe another learner's history for the
  -- existence of an explanation, and before the balance check, so replay works with an empty
  -- wallet — the learner is being handed something they have already paid for.
  --
  -- Only when an attempt anchors the request. Without one the references are a loose bag of
  -- card ids with no natural identity, and a false replay would hand back an answer about a
  -- different question. Refusing to dedupe there is the conservative direction.
  IF p_attempt_id IS NOT NULL THEN
    -- Serializes two presses that arrive together. Transaction-scoped, so it is released at
    -- COMMIT — it orders the lookups, and the in-flight check below is what covers the much
    -- longer window while the model is thinking.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_uid::text || '|' || p_attempt_id::text || '|' || p_action, 0));

    SELECT id, content INTO v_existing_id, v_existing_content
      FROM user_enrichments
     WHERE user_id = v_uid AND attempt_id = p_attempt_id AND action = p_action
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'replay', true,
        'enrichment_id', v_existing_id,
        'content', v_existing_content,
        'job_kind', 'remediation');
    END IF;

    -- Reserved, not yet settled, and recent: the model has not answered yet. Two minutes is
    -- comfortably longer than a generation and short enough that an abandoned job frees the
    -- feature again on its own.
    IF EXISTS (
      SELECT 1 FROM ai_generation_jobs
       WHERE user_id = v_uid
         AND remediation_attempt_id = p_attempt_id
         AND job_kind = 'remediation'
         AND charged = false AND refunded = false
         AND created_at > now() - interval '2 minutes'
    ) THEN
      RAISE EXCEPTION 'Remediation already in flight' USING errcode = '55006';
    END IF;
  END IF;

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
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction,
     remediation_attempt_id)
  VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 1.0, p_attempt_id);

  RETURN jsonb_build_object(
    'job_ref', v_ref, 'billable_fraction', 1.0, 'job_kind', 'remediation', 'replay', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  TO authenticated;

COMMIT;
