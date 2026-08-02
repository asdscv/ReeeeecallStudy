-- ============================================================================
-- 185: "더 하기" — add to today's plan without destroying what is already done
--
-- ── The problem ─────────────────────────────────────────────────────────────
--
-- A learner who finishes today's plan and wants to keep going has exactly one
-- tool: `save_daily_plan`. That function DELETES every item and resets
-- `completed_items`/`completed_minutes` to zero. So "I want to study more" is
-- served by an operation that erases the evidence that they studied at all — and
-- if the plan reached `status = 'completed'`, it refuses outright (P0007).
--
-- The result is a product that can only be used in one shape: exactly the amount
-- it decided this morning. Wanting more is not an edge case; it is the behaviour
-- of the learners who are doing best.
--
-- ── What this adds ──────────────────────────────────────────────────────────
--
-- `append_daily_plan_items` — the same validation as `save_daily_plan` over the
-- same item shape, but it only ever INSERTs. It never touches an existing row's
-- status, never resets a counter, and never deletes.
--
-- Three deliberate differences from `save_daily_plan`:
--
--   1. A COMPLETED plan is a valid target. `save_daily_plan` refuses one because
--      overwriting it would destroy a finished day. Appending adds to it, which is
--      precisely what "다 했는데 더 하고 싶다" means. The status goes back to
--      'active' (not 'pending' — progress is non-zero, and saying otherwise would
--      make the progress line lie).
--
--   2. Cards already in today's plan are SKIPPED, not rejected. The client filters
--      them out, but its list can be stale — another device, another tab, a plan
--      appended a minute ago. Failing the whole call over one stale id would turn a
--      race into an error message; skipping is the same outcome the learner wanted.
--      Both counts are returned so the UI can say what actually happened.
--
--   3. `budget_minutes` is left alone. It records the daily amount the learner
--      committed to, and the entire point of this action is to knowingly go past
--      it. Raising it would erase the distinction between the plan they agreed to
--      and the extra they chose — and tomorrow's "did I meet my budget" would
--      silently answer yes to a day that went over.
--
-- ── Why it charges the same daily counter ───────────────────────────────────
--
-- `plan_saves` (50/UTC day). This is a plan write against the same table, and an
-- append endpoint with no meter is an unmetered write endpoint — the 500-items cap
-- bounds one plan, not the number of calls. Sharing the counter also keeps the
-- budget honest: a learner cannot spend 50 regenerations AND 50 appends.
--
-- Idempotent: CREATE OR REPLACE only. No table or column is altered.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.append_daily_plan_items(
  p_goal_id   uuid,
  p_plan_date date,
  p_items     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_item_count  integer;
  v_plan        record;
  v_item        jsonb;
  v_pos         integer;
  v_appended    integer := 0;
  v_skipped     integer := 0;
  v_card_id     uuid;
  v_usage_row   record;
  v_usage_date  date := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array' USING ERRCODE = 'P0002';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nothing to append' USING ERRCODE = 'P0002';
  END IF;

  -- Same 64KiB payload cap as save_daily_plan. Checked before any work so an
  -- oversized body cannot spend a save.
  IF octet_length(p_items::text) > 65536 THEN
    RAISE EXCEPTION 'Items payload exceeds 64KiB limit' USING ERRCODE = 'P0006';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM learning_goals
     WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  -- The plan must already exist. Creating one here would duplicate every decision
  -- `save_daily_plan` makes about timezone, algorithm version and fingerprint —
  -- fields this function has no honest value for, since it did not do the planning.
  --
  -- FOR UPDATE serialises two appends to the same plan, which is what keeps the
  -- `max(position) + 1` below from handing both the same position and violating
  -- `idx_daily_plan_items_plan_position`.
  --
  -- Measured, not assumed: racing two appends 0.3s apart WITHOUT this lock also
  -- produced 0,1,2 — because the `learning_usage_daily` upsert further down takes a
  -- row lock on the same (user_id, usage_date) tuple and blocks the second caller
  -- first. That is incidental. It holds only while the metering happens to run before
  -- the position is computed, and a plan belongs to one user so there is no other
  -- serialiser. Keeping the explicit lock means the ordering of an unrelated statement
  -- is not what stands between a learner and a 500.
  SELECT * INTO v_plan
    FROM daily_plans
   WHERE user_id = v_uid AND goal_id = p_goal_id AND plan_date = p_plan_date
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No plan for this goal and date' USING ERRCODE = 'P0003';
  END IF;

  -- Abandoned is a deliberate end state ("I am not doing this today"). Reviving it
  -- by a side door would resurrect a plan the learner dismissed; regenerating is the
  -- way back, and it is the operation that says so out loud.
  IF v_plan.status = 'abandoned' THEN
    RAISE EXCEPTION 'Cannot append to an abandoned plan' USING ERRCODE = 'P0007';
  END IF;

  -- Same 500-item ceiling as save_daily_plan, applied to the TOTAL. Counted from the
  -- rows rather than from `total_items` so a drifted aggregate cannot raise the cap.
  IF (SELECT count(*) FROM daily_plan_items WHERE plan_id = v_plan.id) + v_item_count > 500 THEN
    RAISE EXCEPTION 'Maximum 500 items per plan' USING ERRCODE = 'P0006';
  END IF;

  -- §21.2: shares the 50 plan-writes/UTC-day budget with save_daily_plan.
  INSERT INTO learning_usage_daily (user_id, usage_date, plan_saves)
  VALUES (v_uid, v_usage_date, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET plan_saves = learning_usage_daily.plan_saves + 1,
                updated_at = now()
  RETURNING * INTO v_usage_row;

  IF v_usage_row.plan_saves > 50 THEN
    -- No manual decrement. `save_daily_plan` writes one here, and it is dead code: the
    -- RAISE below aborts the statement, and Postgres rolls the increment back with it.
    -- Verified by mutation — deleting the decrement from either function leaves the
    -- counter at exactly 50, which is what `append_plan_test.sql` (11b) asserts. Code
    -- that cannot be shown to do anything is code the next reader has to re-derive, so
    -- it is not copied forward.
    RAISE EXCEPTION 'Daily plan save limit (50) exceeded' USING ERRCODE = 'P0006';
  END IF;

  -- Positions continue from the end. `idx_daily_plan_items_plan_position` is UNIQUE
  -- on (plan_id, position), so restarting at 0 would collide; and the order is what
  -- the learner sees, so appended work belongs after the work already there.
  SELECT COALESCE(max(position), -1) + 1 INTO v_pos
    FROM daily_plan_items WHERE plan_id = v_plan.id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'activity_id') IS NULL AND (v_item->>'card_id') IS NULL THEN
      RAISE EXCEPTION 'Item requires activity_id or card_id' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'activity_type', '') = '' THEN
      RAISE EXCEPTION 'Item missing activity_type' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'stimulus_type', '') = '' THEN
      RAISE EXCEPTION 'Item missing stimulus_type' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'response_type', '') = '' THEN
      RAISE EXCEPTION 'Item missing response_type' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_item->>'evaluator_type', '') = '' THEN
      RAISE EXCEPTION 'Item missing evaluator_type' USING ERRCODE = 'P0002';
    END IF;
    IF btrim(COALESCE(v_item->>'reason_code', '')) = '' THEN
      RAISE EXCEPTION 'Item missing reason_code' USING ERRCODE = 'P0002';
    END IF;
    IF v_item ? 'priority' AND v_item->'priority' <> 'null'::jsonb AND (CASE
      WHEN jsonb_typeof(v_item->'priority') IS DISTINCT FROM 'number' THEN true
      ELSE (v_item->>'priority')::numeric < 0 OR (v_item->>'priority')::numeric > 1
    END) THEN
      RAISE EXCEPTION 'Item priority must be 0–1' USING ERRCODE = 'P0002';
    END IF;
    IF v_item ? 'estimated_minutes' AND v_item->'estimated_minutes' <> 'null'::jsonb AND (CASE
      WHEN jsonb_typeof(v_item->'estimated_minutes') IS DISTINCT FROM 'number' THEN true
      ELSE (v_item->>'estimated_minutes')::numeric <= 0
    END) THEN
      RAISE EXCEPTION 'Item estimated_minutes must be positive' USING ERRCODE = 'P0002';
    END IF;

    IF (v_item->>'activity_id') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM learning_activities
         WHERE id = (v_item->>'activity_id')::uuid
           AND (owner_user_id = v_uid OR owner_user_id IS NULL)
      ) THEN
        RAISE EXCEPTION 'Item references inaccessible activity' USING ERRCODE = 'P0003';
      END IF;
    END IF;

    v_card_id := (v_item->>'card_id')::uuid;
    IF v_card_id IS NOT NULL THEN
      -- Same access check as save_daily_plan: owned or subscribed, and not
      -- study-locked. Appending must not become the way past a card limit.
      IF NOT public._check_card_access(v_uid, v_card_id) THEN
        RAISE EXCEPTION 'Item references inaccessible or study-locked card' USING ERRCODE = 'P0003';
      END IF;
    END IF;

    IF (v_item->>'concept_id') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM learning_concepts
         WHERE id = (v_item->>'concept_id')::uuid
           AND (owner_user_id = v_uid OR owner_user_id IS NULL)
      ) THEN
        RAISE EXCEPTION 'Item references inaccessible concept' USING ERRCODE = 'P0003';
      END IF;
    END IF;

    -- Already in today's plan — including anything appended earlier in THIS call,
    -- since each insert is visible to the next iteration. A duplicate would show the
    -- learner the same card twice and count it twice in `total_items`.
    IF v_card_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM daily_plan_items
       WHERE plan_id = v_plan.id AND card_id = v_card_id
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO daily_plan_items (
      plan_id, position, activity_id, card_id, concept_id,
      activity_type, stimulus_type, response_type, evaluator_type,
      reason_code, priority, estimated_minutes, payload
    )
    VALUES (
      v_plan.id,
      v_pos,
      (v_item->>'activity_id')::uuid,
      v_card_id,
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
    v_appended := v_appended + 1;
  END LOOP;

  IF v_appended > 0 THEN
    UPDATE daily_plans
       SET total_items = total_items + v_appended,
           -- There is unfinished work again, so 'completed' is no longer true. 'active'
           -- rather than 'pending' whenever anything has been done: `pending` means "not
           -- started", and the progress line reads from this.
           status = CASE WHEN completed_items > 0 THEN 'active' ELSE 'pending' END
     WHERE id = v_plan.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'plan_id', v_plan.id,
    'appended', v_appended,
    'skipped', v_skipped,
    -- Recomputed rather than echoed: the caller uses this to decide whether the
    -- 500 ceiling has been reached, and an echo of its own arithmetic would not.
    'total_items', (SELECT count(*) FROM daily_plan_items WHERE plan_id = v_plan.id)
  );
END;
$$;

COMMENT ON FUNCTION public.append_daily_plan_items(uuid, date, jsonb) IS
  'Add items to an existing daily plan without deleting or resetting anything. Skips cards '
  'already in the plan. Shares the 50 plan-writes/UTC-day budget with save_daily_plan.';

-- Default privileges GRANT EXECUTE to PUBLIC on creation and CREATE OR REPLACE does
-- not re-alter them, so revoke before granting.
REVOKE EXECUTE ON FUNCTION public.append_daily_plan_items(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_daily_plan_items(uuid, date, jsonb) TO authenticated;

COMMIT;
