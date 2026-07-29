-- ============================================================================
-- 162: LEARNING ENGINE RPCS — Goal, Plan, Attempt, Enrichment write RPCs
--
-- Design: DOCS/TODO/2026-07-29-modular-learning-engine-design.md §8.2–8.5, §21
--
-- Delivers:
--   1. learning_usage_daily table for rate-limiting (deny-all base grants).
--   2. create_learning_goal / update_learning_goal / archive_learning_goal
--   3. create_private_source / create_private_concept / create_private_activity
--   4. save_daily_plan (max 500 items, 64KiB, goal ownership, FK validation)
--   5. record_answer_attempt (max 5000/UTC day, 64KiB, idempotent)
--   6. set_user_enrichment_status
--   7. Internal helpers (SECURITY DEFINER, revoked from PUBLIC/anon/authenticated)
--
-- Principles:
--   * All user-facing fns: search_path = public, auth.uid(), PUBLIC+anon revoke.
--   * No direct writes on mig-160 tables from clients.
--   * Extensible strings validated as nonempty; lifecycle enums are closed.
--   * service/admin shared import deferred to 163+.
-- ============================================================================

-- ── 1) learning_usage_daily — atomic rate-limit counters ────────────────────
CREATE TABLE IF NOT EXISTS learning_usage_daily (
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  usage_date  date NOT NULL DEFAULT (CURRENT_DATE AT TIME ZONE 'UTC'),
  plan_saves  integer NOT NULL DEFAULT 0 CHECK (plan_saves >= 0),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE learning_usage_daily ENABLE ROW LEVEL SECURITY;

-- Deny-all: no SELECT/INSERT/UPDATE/DELETE for anon or authenticated
REVOKE ALL ON learning_usage_daily FROM anon, authenticated;
GRANT ALL ON learning_usage_daily TO service_role;

-- ── 2) create_learning_goal ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_learning_goal(
  p_domain_id     text,
  p_title         text,
  p_daily_minutes integer,
  p_target_date   date     DEFAULT NULL,
  p_target        jsonb    DEFAULT '{}'::jsonb,
  p_settings      jsonb    DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_count    integer;
  v_goal_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Validate inputs
  IF p_domain_id IS NULL OR p_domain_id = '' THEN
    RAISE EXCEPTION 'domain_id must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 500 THEN
    RAISE EXCEPTION 'title must be 1–500 characters' USING ERRCODE = 'P0002';
  END IF;
  IF p_daily_minutes IS NULL OR p_daily_minutes < 1 OR p_daily_minutes > 1440 THEN
    RAISE EXCEPTION 'daily_minutes must be 1–1440' USING ERRCODE = 'P0002';
  END IF;

  -- §21.2: serialize per-user cap checks and cap 100 non-archived goals.
  PERFORM pg_advisory_xact_lock(hashtextextended('learning-goals:' || v_uid::text, 0));
  SELECT count(*) INTO v_count
    FROM learning_goals
   WHERE user_id = v_uid AND status <> 'archived';

  IF v_count >= 100 THEN
    RAISE EXCEPTION 'Maximum 100 non-archived goals reached' USING ERRCODE = 'P0006';
  END IF;

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes, target_date, target, settings)
  VALUES (v_uid, p_domain_id, p_title, p_daily_minutes, p_target_date, p_target, p_settings)
  RETURNING id INTO v_goal_id;

  RETURN jsonb_build_object('ok', true, 'goal_id', v_goal_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_learning_goal(text, text, integer, date, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_learning_goal(text, text, integer, date, jsonb, jsonb)
  TO authenticated;

-- ── 3) update_learning_goal ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_learning_goal(
  p_goal_id       uuid,
  p_title         text     DEFAULT NULL,
  p_daily_minutes integer  DEFAULT NULL,
  p_target_date   date     DEFAULT NULL,
  p_status        text     DEFAULT NULL,
  p_target        jsonb    DEFAULT NULL,
  p_settings      jsonb    DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_current record;
  v_count   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_current
    FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found or not owned' USING ERRCODE = 'P0003';
  END IF;

  -- Archived goals are immutable except for an explicit archived → active transition.
  IF v_current.status = 'archived' AND p_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Archived goals can only transition to active' USING ERRCODE = 'P0007';
  END IF;

  -- Validate fields if provided
  IF p_title IS NOT NULL AND (char_length(p_title) < 1 OR char_length(p_title) > 500) THEN
    RAISE EXCEPTION 'title must be 1–500 characters' USING ERRCODE = 'P0002';
  END IF;
  IF p_daily_minutes IS NOT NULL AND (p_daily_minutes < 1 OR p_daily_minutes > 1440) THEN
    RAISE EXCEPTION 'daily_minutes must be 1–1440' USING ERRCODE = 'P0002';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','paused','completed','archived') THEN
    RAISE EXCEPTION 'Invalid status value' USING ERRCODE = 'P0002';
  END IF;

  -- Stable lifecycle transitions.
  IF p_status IS NOT NULL AND p_status <> v_current.status AND NOT (
    (v_current.status = 'active' AND p_status IN ('paused','completed','archived'))
    OR (v_current.status = 'paused' AND p_status IN ('active','archived'))
    OR (v_current.status = 'completed' AND p_status = 'archived')
    OR (v_current.status = 'archived' AND p_status = 'active')
  ) THEN
    RAISE EXCEPTION 'Invalid goal status transition: % -> %', v_current.status, p_status USING ERRCODE = 'P0007';
  END IF;

  -- Unarchiving consumes a non-archived goal slot; serialize with create.
  IF v_current.status = 'archived' AND p_status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('learning-goals:' || v_uid::text, 0));
    SELECT count(*) INTO v_count FROM learning_goals
      WHERE user_id = v_uid AND status <> 'archived';
    IF v_count >= 100 THEN
      RAISE EXCEPTION 'Maximum 100 non-archived goals reached' USING ERRCODE = 'P0006';
    END IF;
  END IF;

  UPDATE learning_goals SET
    title         = COALESCE(p_title, title),
    daily_minutes = COALESCE(p_daily_minutes, daily_minutes),
    target_date   = COALESCE(p_target_date, target_date),
    status        = COALESCE(p_status, status),
    target        = COALESCE(p_target, target),
    settings      = COALESCE(p_settings, settings)
  WHERE id = p_goal_id;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_learning_goal(uuid, text, integer, date, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_learning_goal(uuid, text, integer, date, text, jsonb, jsonb)
  TO authenticated;

-- ── 4) archive_learning_goal ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_learning_goal(p_goal_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  UPDATE learning_goals
     SET status = 'archived'
   WHERE id = p_goal_id
     AND user_id = v_uid
     AND status <> 'archived';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found, not owned, or already archived' USING ERRCODE = 'P0003';
  END IF;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_learning_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_learning_goal(uuid) TO authenticated;

-- ── 5) create_private_source ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_private_source(
  p_domain_id   text,
  p_source_type text,
  p_title       text,
  p_source_uri  text  DEFAULT NULL,
  p_citation    text  DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_domain_id IS NULL OR p_domain_id = '' THEN
    RAISE EXCEPTION 'domain_id must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_type IS NULL OR p_source_type = '' THEN
    RAISE EXCEPTION 'source_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 500 THEN
    RAISE EXCEPTION 'title must be 1–500 characters' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO content_sources (owner_user_id, domain_id, source_type, title, source_uri, citation, metadata)
  VALUES (v_uid, p_domain_id, p_source_type, p_title, p_source_uri, p_citation, p_metadata)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'source_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_private_source(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_private_source(text, text, text, text, text, jsonb)
  TO authenticated;

-- ── 6) create_private_concept ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_private_concept(
  p_domain_id    text,
  p_concept_key  text,
  p_title        text,
  p_description  text  DEFAULT NULL,
  p_source_id    uuid  DEFAULT NULL,
  p_metadata     jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_domain_id IS NULL OR p_domain_id = '' THEN
    RAISE EXCEPTION 'domain_id must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_concept_key IS NULL OR p_concept_key = '' THEN
    RAISE EXCEPTION 'concept_key must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 500 THEN
    RAISE EXCEPTION 'title must be 1–500 characters' USING ERRCODE = 'P0002';
  END IF;

  -- Validate source ownership if provided
  IF p_source_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM content_sources
       WHERE id = p_source_id AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Source not found or not accessible' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  INSERT INTO learning_concepts (owner_user_id, domain_id, concept_key, title, description, source_id, metadata)
  VALUES (v_uid, p_domain_id, p_concept_key, p_title, p_description, p_source_id, p_metadata)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'concept_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_private_concept(text, text, text, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_private_concept(text, text, text, text, uuid, jsonb)
  TO authenticated;

-- ── 7) create_private_activity ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_private_activity(
  p_activity_type   text,
  p_stimulus_type   text,
  p_response_type   text,
  p_evaluator_type  text,
  p_title           text,
  p_concept_id      uuid  DEFAULT NULL,
  p_card_id         uuid  DEFAULT NULL,
  p_source_id       uuid  DEFAULT NULL,
  p_instructions    text  DEFAULT NULL,
  p_stimulus        jsonb DEFAULT NULL,
  p_expected_response jsonb DEFAULT NULL,
  p_rubric          jsonb DEFAULT NULL,
  p_config          jsonb DEFAULT '{}'::jsonb,
  p_difficulty      numeric DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Validate non-empty strings
  IF p_activity_type IS NULL OR p_activity_type = '' THEN
    RAISE EXCEPTION 'activity_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_stimulus_type IS NULL OR p_stimulus_type = '' THEN
    RAISE EXCEPTION 'stimulus_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_response_type IS NULL OR p_response_type = '' THEN
    RAISE EXCEPTION 'response_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_evaluator_type IS NULL OR p_evaluator_type = '' THEN
    RAISE EXCEPTION 'evaluator_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_title IS NULL OR char_length(p_title) < 1 OR char_length(p_title) > 500 THEN
    RAISE EXCEPTION 'title must be 1–500 characters' USING ERRCODE = 'P0002';
  END IF;
  IF p_difficulty IS NOT NULL AND (p_difficulty < 0 OR p_difficulty > 1) THEN
    RAISE EXCEPTION 'difficulty must be 0–1' USING ERRCODE = 'P0002';
  END IF;

  -- card_id or stimulus required (DB constraint also enforces)
  IF p_card_id IS NULL AND (p_stimulus IS NULL OR p_stimulus = '{}'::jsonb OR jsonb_typeof(p_stimulus) <> 'object') THEN
    RAISE EXCEPTION 'Either card_id or a non-empty stimulus object is required' USING ERRCODE = 'P0002';
  END IF;

  -- Validate card ownership if provided
  IF p_card_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cards WHERE id = p_card_id AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Card not found or not owned' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Validate concept accessibility if provided
  IF p_concept_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM learning_concepts
       WHERE id = p_concept_id AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Concept not found or not accessible' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Validate source accessibility if provided
  IF p_source_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM content_sources
       WHERE id = p_source_id AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Source not found or not accessible' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  INSERT INTO learning_activities (
    owner_user_id, concept_id, card_id, source_id,
    activity_type, stimulus_type, response_type, evaluator_type,
    title, instructions, stimulus, expected_response, rubric, config, difficulty
  )
  VALUES (
    v_uid, p_concept_id, p_card_id, p_source_id,
    p_activity_type, p_stimulus_type, p_response_type, p_evaluator_type,
    p_title, p_instructions, p_stimulus, p_expected_response, p_rubric, p_config, p_difficulty
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'activity_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_private_activity(
  text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_private_activity(
  text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, numeric
) TO authenticated;

-- ── 8) save_daily_plan ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_daily_plan(
  p_goal_id           uuid,
  p_plan_date         date,
  p_timezone          text,
  p_algorithm_version text,
  p_input_fingerprint text,
  p_budget_minutes    integer,
  p_items             jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_item_count  integer;
  v_plan_id     uuid;
  v_existing    record;
  v_item        jsonb;
  v_pos         integer;
  v_usage_row   record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Validate inputs
  IF p_timezone IS NULL OR p_timezone = '' THEN
    RAISE EXCEPTION 'timezone must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_algorithm_version IS NULL OR p_algorithm_version = '' THEN
    RAISE EXCEPTION 'algorithm_version must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_input_fingerprint IS NULL OR p_input_fingerprint = '' THEN
    RAISE EXCEPTION 'input_fingerprint must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_budget_minutes IS NULL OR p_budget_minutes < 1 OR p_budget_minutes > 1440 THEN
    RAISE EXCEPTION 'budget_minutes must be 1–1440' USING ERRCODE = 'P0002';
  END IF;

  -- Items validation
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array' USING ERRCODE = 'P0002';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count > 500 THEN
    RAISE EXCEPTION 'Maximum 500 items per plan' USING ERRCODE = 'P0006';
  END IF;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Plan must have at least one item' USING ERRCODE = 'P0002';
  END IF;

  -- §21.2: 64KiB payload cap
  IF octet_length(p_items::text) > 65536 THEN
    RAISE EXCEPTION 'Items payload exceeds 64KiB limit' USING ERRCODE = 'P0006';
  END IF;

  -- Goal ownership verification
  IF NOT EXISTS (
    SELECT 1 FROM learning_goals
     WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  -- §21.2: 50 plan saves/UTC day
  INSERT INTO learning_usage_daily (user_id, usage_date, plan_saves)
  VALUES (v_uid, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET plan_saves = learning_usage_daily.plan_saves + 1,
                updated_at = now()
  RETURNING * INTO v_usage_row;

  IF v_usage_row.plan_saves > 50 THEN
    -- Undo the increment
    UPDATE learning_usage_daily
       SET plan_saves = plan_saves - 1
     WHERE user_id = v_uid AND usage_date = v_usage_row.usage_date;
    RAISE EXCEPTION 'Daily plan save limit (50) exceeded' USING ERRCODE = 'P0006';
  END IF;

  -- Check for existing plan (completed plan cannot be overwritten)
  SELECT id, status INTO v_existing
    FROM daily_plans
   WHERE user_id = v_uid AND goal_id = p_goal_id AND plan_date = p_plan_date
     FOR UPDATE;

  IF FOUND AND v_existing.status = 'completed' THEN
    -- Undo the usage increment
    UPDATE learning_usage_daily
       SET plan_saves = plan_saves - 1
     WHERE user_id = v_uid AND usage_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
    RAISE EXCEPTION 'Cannot overwrite a completed plan' USING ERRCODE = 'P0007';
  END IF;

  IF FOUND THEN
    -- Delete existing items and update plan
    DELETE FROM daily_plan_items WHERE plan_id = v_existing.id;
    UPDATE daily_plans SET
      timezone = p_timezone,
      algorithm_version = p_algorithm_version,
      input_fingerprint = p_input_fingerprint,
      status = 'pending',
      budget_minutes = p_budget_minutes,
      completed_minutes = 0,
      completed_items = 0,
      total_items = v_item_count
    WHERE id = v_existing.id;
    v_plan_id := v_existing.id;
  ELSE
    INSERT INTO daily_plans (
      user_id, goal_id, plan_date, timezone, algorithm_version,
      input_fingerprint, budget_minutes, total_items
    )
    VALUES (
      v_uid, p_goal_id, p_plan_date, p_timezone, p_algorithm_version,
      p_input_fingerprint, p_budget_minutes, v_item_count
    )
    RETURNING id INTO v_plan_id;
  END IF;

  -- Insert normalized items with FK validation
  v_pos := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'activity_id') IS NULL AND (v_item->>'card_id') IS NULL THEN
      RAISE EXCEPTION 'Item % requires activity_id or card_id', v_pos USING ERRCODE = 'P0002';
    END IF;

    -- Validate required non-empty strings per item
    IF COALESCE(v_item->>'activity_type', '') = '' THEN
      RAISE EXCEPTION 'Item % missing activity_type', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'stimulus_type', '') = '' THEN
      RAISE EXCEPTION 'Item % missing stimulus_type', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'response_type', '') = '' THEN
      RAISE EXCEPTION 'Item % missing response_type', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'evaluator_type', '') = '' THEN
      RAISE EXCEPTION 'Item % missing evaluator_type', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF btrim(COALESCE(v_item->>'reason_code', '')) = '' THEN
      RAISE EXCEPTION 'Item % missing reason_code', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF v_item ? 'priority' AND v_item->'priority' <> 'null'::jsonb AND (CASE
      WHEN jsonb_typeof(v_item->'priority') IS DISTINCT FROM 'number' THEN true
      ELSE (v_item->>'priority')::numeric < 0 OR (v_item->>'priority')::numeric > 1
    END) THEN
      RAISE EXCEPTION 'Item % priority must be 0–1', v_pos USING ERRCODE = 'P0002';
    END IF;
    IF v_item ? 'estimated_minutes' AND v_item->'estimated_minutes' <> 'null'::jsonb AND (CASE
      WHEN jsonb_typeof(v_item->'estimated_minutes') IS DISTINCT FROM 'number' THEN true
      ELSE (v_item->>'estimated_minutes')::numeric <= 0
    END) THEN
      RAISE EXCEPTION 'Item % estimated_minutes must be positive', v_pos USING ERRCODE = 'P0002';
    END IF;

    -- FK validation: activity must be accessible
    IF (v_item->>'activity_id') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM learning_activities
         WHERE id = (v_item->>'activity_id')::uuid
           AND (owner_user_id = v_uid OR owner_user_id IS NULL)
      ) THEN
        RAISE EXCEPTION 'Item % references inaccessible activity', v_pos USING ERRCODE = 'P0003';
      END IF;
    END IF;

    -- FK validation: card must be accessible (owned or subscribed)
    IF (v_item->>'card_id') IS NOT NULL THEN
      IF NOT public._check_card_access(v_uid, (v_item->>'card_id')::uuid) THEN
        RAISE EXCEPTION 'Item % references inaccessible or study-locked card', v_pos USING ERRCODE = 'P0003';
      END IF;
    END IF;

    -- FK validation: concept must be accessible
    IF (v_item->>'concept_id') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM learning_concepts
         WHERE id = (v_item->>'concept_id')::uuid
           AND (owner_user_id = v_uid OR owner_user_id IS NULL)
      ) THEN
        RAISE EXCEPTION 'Item % references inaccessible concept', v_pos USING ERRCODE = 'P0003';
      END IF;
    END IF;

    INSERT INTO daily_plan_items (
      plan_id, position, activity_id, card_id, concept_id,
      activity_type, stimulus_type, response_type, evaluator_type,
      reason_code, priority, estimated_minutes, payload
    )
    VALUES (
      v_plan_id,
      v_pos,
      (v_item->>'activity_id')::uuid,
      (v_item->>'card_id')::uuid,
      (v_item->>'concept_id')::uuid,
      v_item->>'activity_type',
      v_item->>'stimulus_type',
      v_item->>'response_type',
      v_item->>'evaluator_type',
      v_item->>'reason_code',
      COALESCE((v_item->>'priority')::numeric, 0),
      COALESCE((v_item->>'estimated_minutes')::numeric, 1),
      COALESCE(NULLIF(v_item->'payload', 'null'::jsonb), '{}'::jsonb)
    );

    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'plan_id', v_plan_id, 'total_items', v_item_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_daily_plan(uuid, date, text, text, text, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_plan(uuid, date, text, text, text, integer, jsonb)
  TO authenticated;

-- ── 9) record_answer_attempt ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_answer_attempt(
  p_client_attempt_id uuid,
  p_activity_type     text,
  p_response_type     text,
  p_evaluator_type    text,
  p_response          jsonb    DEFAULT '{}'::jsonb,
  p_goal_id           uuid     DEFAULT NULL,
  p_activity_id       uuid     DEFAULT NULL,
  p_card_id           uuid     DEFAULT NULL,
  p_plan_item_id      uuid     DEFAULT NULL,
  p_normalized_score  numeric  DEFAULT NULL,
  p_evaluator_result  jsonb    DEFAULT NULL,
  p_feedback          jsonb    DEFAULT NULL,
  p_hints_used        integer  DEFAULT 0,
  p_duration_ms       integer  DEFAULT 0,
  p_evaluator_version text     DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_attempt_id  uuid;
  v_existing    record;
  v_plan_item   record;
  v_plan        record;
  v_usage_row   record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Validate required non-empty strings
  IF p_activity_type IS NULL OR p_activity_type = '' THEN
    RAISE EXCEPTION 'activity_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_response_type IS NULL OR p_response_type = '' THEN
    RAISE EXCEPTION 'response_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;
  IF p_evaluator_type IS NULL OR p_evaluator_type = '' THEN
    RAISE EXCEPTION 'evaluator_type must be non-empty' USING ERRCODE = 'P0002';
  END IF;

  -- At least one of activity_id or card_id required
  IF p_activity_id IS NULL AND p_card_id IS NULL THEN
    RAISE EXCEPTION 'Either activity_id or card_id is required' USING ERRCODE = 'P0002';
  END IF;

  -- Bounds validation
  IF p_normalized_score IS NOT NULL AND (p_normalized_score < 0 OR p_normalized_score > 1) THEN
    RAISE EXCEPTION 'normalized_score must be 0–1' USING ERRCODE = 'P0002';
  END IF;
  IF p_hints_used IS NOT NULL AND p_hints_used < 0 THEN
    RAISE EXCEPTION 'hints_used must be non-negative' USING ERRCODE = 'P0002';
  END IF;
  IF p_duration_ms IS NOT NULL AND p_duration_ms < 0 THEN
    RAISE EXCEPTION 'duration_ms must be non-negative' USING ERRCODE = 'P0002';
  END IF;

  -- §21.2: 64KiB response payload limit
  IF p_response IS NOT NULL AND octet_length(p_response::text) > 65536 THEN
    RAISE EXCEPTION 'Response payload exceeds 64KiB limit' USING ERRCODE = 'P0006';
  END IF;
  IF p_evaluator_result IS NOT NULL AND octet_length(p_evaluator_result::text) > 65536 THEN
    RAISE EXCEPTION 'Evaluator result payload exceeds 64KiB limit' USING ERRCODE = 'P0006';
  END IF;
  IF p_feedback IS NOT NULL AND octet_length(p_feedback::text) > 65536 THEN
    RAISE EXCEPTION 'Feedback payload exceeds 64KiB limit' USING ERRCODE = 'P0006';
  END IF;

  IF p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'client_attempt_id is required' USING ERRCODE = 'P0002';
  END IF;

  -- Serialize concurrent retries before duplicate lookup and usage accounting.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_client_attempt_id::text, 0)
  );

  -- Idempotency check
  SELECT id, goal_id, activity_id, card_id, plan_item_id,
         activity_type, response_type, evaluator_type, response, normalized_score,
         evaluator_result, feedback, hints_used, duration_ms, evaluator_version
    INTO v_existing
    FROM answer_attempts
   WHERE user_id = v_uid AND client_attempt_id = p_client_attempt_id;

  IF FOUND THEN
    IF v_existing.goal_id IS DISTINCT FROM p_goal_id
       OR v_existing.activity_id IS DISTINCT FROM p_activity_id
       OR v_existing.card_id IS DISTINCT FROM p_card_id
       OR v_existing.plan_item_id IS DISTINCT FROM p_plan_item_id
       OR v_existing.activity_type IS DISTINCT FROM p_activity_type
       OR v_existing.response_type IS DISTINCT FROM p_response_type
       OR v_existing.evaluator_type IS DISTINCT FROM p_evaluator_type
       OR v_existing.response IS DISTINCT FROM p_response
       OR v_existing.normalized_score IS DISTINCT FROM p_normalized_score
       OR v_existing.evaluator_result IS DISTINCT FROM p_evaluator_result
       OR v_existing.feedback IS DISTINCT FROM p_feedback
       OR v_existing.hints_used IS DISTINCT FROM COALESCE(p_hints_used, 0)
       OR v_existing.duration_ms IS DISTINCT FROM COALESCE(p_duration_ms, 0)
       OR v_existing.evaluator_version IS DISTINCT FROM p_evaluator_version THEN
      RAISE EXCEPTION 'client_attempt_id was reused with a different payload' USING ERRCODE = 'P0007';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'attempt_id', v_existing.id
    );
  END IF;

  -- §21.2: 5000 attempts/UTC day
  INSERT INTO learning_usage_daily (user_id, usage_date, attempts)
  VALUES (v_uid, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET attempts = learning_usage_daily.attempts + 1,
                updated_at = now()
  RETURNING * INTO v_usage_row;

  IF v_usage_row.attempts > 5000 THEN
    UPDATE learning_usage_daily
       SET attempts = attempts - 1
     WHERE user_id = v_uid AND usage_date = v_usage_row.usage_date;
    RAISE EXCEPTION 'Daily attempt limit (5000) exceeded' USING ERRCODE = 'P0006';
  END IF;

  -- Ownership/entitlement: goal
  IF p_goal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Goal not found or not owned' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Ownership/entitlement: activity
  IF p_activity_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM learning_activities
       WHERE id = p_activity_id AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Activity not found or not accessible' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Ownership/entitlement: card (owned or subscribed)
  IF p_card_id IS NOT NULL THEN
    IF NOT public._check_card_access(v_uid, p_card_id) THEN
      RAISE EXCEPTION 'Card not found, inaccessible, or study-locked' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Ownership: plan_item (must belong to caller's plan)
  IF p_plan_item_id IS NOT NULL THEN
    SELECT dpi.id, dpi.plan_id, dpi.status, dpi.activity_id, dpi.card_id,
           dpi.activity_type, dpi.response_type, dpi.evaluator_type, dp.goal_id
      INTO v_plan_item
      FROM daily_plan_items dpi
      JOIN daily_plans dp ON dp.id = dpi.plan_id
     WHERE dpi.id = p_plan_item_id AND dp.user_id = v_uid
     FOR UPDATE OF dpi, dp;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plan item not found or not owned' USING ERRCODE = 'P0003';
    END IF;
    IF p_goal_id IS DISTINCT FROM v_plan_item.goal_id
       OR p_activity_id IS DISTINCT FROM v_plan_item.activity_id
       OR p_card_id IS DISTINCT FROM v_plan_item.card_id
       OR p_activity_type IS DISTINCT FROM v_plan_item.activity_type
       OR p_response_type IS DISTINCT FROM v_plan_item.response_type
       OR p_evaluator_type IS DISTINCT FROM v_plan_item.evaluator_type THEN
      RAISE EXCEPTION 'Attempt targets do not match the plan item snapshot' USING ERRCODE = 'P0007';
    END IF;
  END IF;

  -- Insert the attempt
  INSERT INTO answer_attempts (
    user_id, goal_id, activity_id, card_id, plan_item_id,
    client_attempt_id, activity_type, response_type, evaluator_type,
    response, normalized_score, evaluator_result, feedback,
    hints_used, duration_ms, evaluator_version
  )
  VALUES (
    v_uid, p_goal_id, p_activity_id, p_card_id, p_plan_item_id,
    p_client_attempt_id, p_activity_type, p_response_type, p_evaluator_type,
    p_response, p_normalized_score, p_evaluator_result, p_feedback,
    COALESCE(p_hints_used, 0), COALESCE(p_duration_ms, 0), p_evaluator_version
  )
  RETURNING id INTO v_attempt_id;

  -- Atomic plan item completion + plan aggregates
  IF p_plan_item_id IS NOT NULL AND v_plan_item.status = 'pending' THEN
    UPDATE daily_plan_items
       SET status = 'completed',
           completion_attempt_id = v_attempt_id
     WHERE id = p_plan_item_id;

    -- Update plan aggregates
    SELECT * INTO v_plan FROM daily_plans WHERE id = v_plan_item.plan_id FOR UPDATE;
    UPDATE daily_plans
       SET completed_items = completed_items + 1,
           completed_minutes = completed_minutes + COALESCE(p_duration_ms / 60000, 0),
           status = CASE
             WHEN completed_items + 1 >= total_items THEN 'completed'
             WHEN status = 'pending' THEN 'active'
             ELSE status
           END
     WHERE id = v_plan_item.plan_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'attempt_id', v_attempt_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_answer_attempt(
  uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, integer, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_answer_attempt(
  uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid, numeric, jsonb, jsonb, integer, integer, text
) TO authenticated;

-- ── 10) set_user_enrichment_status ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_enrichment_status(
  p_enrichment_id uuid,
  p_status        text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_current record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Only allow stable lifecycle transitions: closed = accepted/rejected/deleted
  IF p_status NOT IN ('accepted','rejected','deleted') THEN
    RAISE EXCEPTION 'Status must be accepted, rejected, or deleted' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_current
    FROM user_enrichments
   WHERE id = p_enrichment_id AND user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrichment not found or not owned' USING ERRCODE = 'P0003';
  END IF;

  -- Only preview status can transition (closed statuses are terminal)
  IF v_current.status <> 'preview' THEN
    RAISE EXCEPTION 'Enrichment status is already finalized (%)', v_current.status USING ERRCODE = 'P0007';
  END IF;

  UPDATE user_enrichments
     SET status = p_status,
         accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE NULL END
   WHERE id = p_enrichment_id;

  RETURN jsonb_build_object('ok', true, 'enrichment_id', p_enrichment_id, 'status', p_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_enrichment_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_enrichment_status(uuid, text) TO authenticated;

-- ── 11) Internal helper: _check_card_access ─────────────────────────────────
-- Returns true if p_uid can study p_card_id (owns or active subscribe).
-- SECURITY DEFINER, no client access.
CREATE OR REPLACE FUNCTION public._check_card_access(p_uid uuid, p_card_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND p_uid = auth.uid() AND EXISTS (
    SELECT 1
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
     WHERE c.id = p_card_id
       AND c.user_id = d.user_id
       AND (
         (
           d.user_id = p_uid
           AND (
             public.get_active_card_threshold() IS NULL
             OR c.created_at <= public.get_active_card_threshold()
             OR (
               EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
               AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false)
             )
           )
         )
         OR (
           EXISTS (
             SELECT 1 FROM deck_shares ds
              WHERE ds.deck_id = d.id AND ds.recipient_id = p_uid
                AND ds.share_mode = 'subscribe' AND ds.status = 'active'
           )
           AND public.is_subscribed_deck_active(d.id)
         )
       )
  );
$$;

REVOKE EXECUTE ON FUNCTION public._check_card_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 12) Internal helper: _check_activity_access ─────────────────────────────
-- Returns true if p_uid can reference p_activity_id (owns or shared/curated).
CREATE OR REPLACE FUNCTION public._check_activity_access(p_uid uuid, p_activity_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM learning_activities
     WHERE id = p_activity_id
       AND (owner_user_id = p_uid OR owner_user_id IS NULL)
  );
$$;

REVOKE EXECUTE ON FUNCTION public._check_activity_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
