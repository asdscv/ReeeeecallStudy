-- Rollback for 193 (Quiz schema).
--
-- Safe to run WITHOUT deleting learner data, and that is a property of the forward
-- migration rather than luck: every quiz question is derived from exactly one card,
-- so `record_quiz_answer` always writes `card_id` alongside `quiz_run_item_id`. The
-- original CHECK (activity_id OR card_id) therefore still holds for every quiz
-- attempt row once the quiz column is gone. If that ever stops being true, this
-- rollback starts failing on the CHECK rather than silently dropping answers —
-- which is the failure mode we want.
--
-- Order matters: drop the column BEFORE the tables it references, and restore the
-- narrower CHECK only after no row can depend on the wider one.

BEGIN;

-- 1) Detach answer_attempts from quiz, restore its original target rule.
DROP INDEX IF EXISTS idx_answer_attempts_quiz_run_item;
ALTER TABLE answer_attempts DROP COLUMN IF EXISTS quiz_run_item_id;

ALTER TABLE answer_attempts DROP CONSTRAINT IF EXISTS attempt_target_required;
ALTER TABLE answer_attempts ADD CONSTRAINT attempt_activity_or_card_required
  CHECK (activity_id IS NOT NULL OR card_id IS NOT NULL);

-- 2) The tables. CASCADE order is handled by the FKs: run_items -> runs -> sets, and
--    questions -> sets. Dropping the parents takes the children with them, but they
--    are listed explicitly so this file states what it destroys.
DROP TRIGGER IF EXISTS quiz_run_items_void_orphans ON quiz_questions;
DROP FUNCTION IF EXISTS public._quiz_void_orphan_items();

DROP TABLE IF EXISTS quiz_run_items;
DROP TABLE IF EXISTS quiz_runs;
DROP TABLE IF EXISTS quiz_questions;
DROP TABLE IF EXISTS quiz_sets;

-- 3) Restore undo_plan_study_rating to its 189 definition — the same body without
--    the `quiz_run_item_id IS NULL` predicate, which now refers to a dropped column.
CREATE OR REPLACE FUNCTION public.undo_plan_study_rating(
  p_event_id          uuid,
  p_client_attempt_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_undo      jsonb;
  v_attempt   answer_attempts%ROWTYPE;
  v_item      daily_plan_items%ROWTYPE;
  v_reopened  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_event_id IS NULL OR p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'event and client attempt ids are required' USING errcode = '22023';
  END IF;

  v_undo := public.undo_study_rating(p_event_id);

  SELECT * INTO v_attempt
    FROM answer_attempts
   WHERE user_id = v_uid AND client_attempt_id = p_client_attempt_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', false);
  END IF;

  IF v_attempt.plan_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM daily_plan_items WHERE id = v_attempt.plan_item_id FOR UPDATE;

    IF FOUND AND v_item.status = 'completed' AND v_item.completion_attempt_id = v_attempt.id THEN
      UPDATE daily_plan_items
         SET status = 'pending', completion_attempt_id = NULL
       WHERE id = v_item.id;

      UPDATE daily_plans
         SET completed_items = GREATEST(0, completed_items - 1),
             completed_minutes = GREATEST(0, completed_minutes - COALESCE(v_attempt.duration_ms / 60000, 0)),
             status = CASE
               WHEN GREATEST(0, completed_items - 1) = 0 THEN 'pending'
               WHEN status = 'completed' THEN 'active'
               ELSE status
             END
       WHERE id = v_item.plan_id;

      v_reopened := true;
    END IF;
  END IF;

  DELETE FROM answer_attempts WHERE id = v_attempt.id;

  RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', v_reopened);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) TO authenticated;

COMMIT;
