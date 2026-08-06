-- ============================================================================
-- 187: one rating that both reschedules the card AND completes the plan item
--
-- ── The problem ─────────────────────────────────────────────────────────────
--
-- The daily plan and the study session have lived in two disjoint universes.
--
--   `apply_study_rating`      writes cards / user_card_progress (the SRS state),
--                             study_rating_events and study_logs. It has never
--                             touched daily_plan_items.
--   `record_answer_attempt`   writes answer_attempts, flips daily_plan_items to
--                             'completed', and moves the daily_plans aggregates.
--                             It has never touched the SRS state.
--
-- So the plan screen offered its own 모름/애매함/알았음 buttons that recorded an
-- attempt and rescheduled NOTHING, and told the learner so in small print
-- ("복습 일정은 바뀌지 않습니다"). Meanwhile the per-row 학습 link opened a whole
-- deck session that knew nothing about the plan. Doing the day's plan therefore
-- meant doing it twice, and only one of the two moved the schedule.
--
-- ── Why a new function and not two client calls ─────────────────────────────
--
-- Two calls in sequence has an unrecoverable failure mode in BOTH orders:
--
--   apply ok / attempt fails  → the card is rescheduled, the plan row still says
--                               pending, and the learner is told nothing was
--                               recorded. Re-rating is refused: the SRS revision
--                               has moved.
--   attempt ok / apply fails  → the plan says done, the card was never
--                               rescheduled, and it resurfaces tomorrow as if the
--                               session never happened.
--
-- and the second is not repairable from a client at all: there is no undo/delete
-- RPC for an attempt, and clients hold SELECT-only on daily_plan_items. One
-- transaction is the only shape that cannot leave the two halves disagreeing.
--
-- This function does NOT reimplement either body. It calls both, so there is
-- still exactly one implementation of "how a rating is applied" and one of "how an
-- attempt is recorded" — the thing that would rot is a copy, and there is none.
--
-- ── The score map, and why it is here ───────────────────────────────────────
--
--   again → 0.0     hard → 0.5     good → 1.0     easy → 1.0
--
-- Deliberately server-side. Web and mobile would otherwise each own a copy of the
-- mapping between a four-button SRS rating and the plan's 0..1 score, and a
-- divergence would be invisible: both platforms would keep working, and the same
-- session would grade differently depending on the device. `hard` maps to the plan
-- UI's existing middle band ("애매함", 0.5) rather than to a failure, because the
-- scheduler treats it as a successful-but-costly recall, not a lapse.
--
-- ── SRS mode only ───────────────────────────────────────────────────────────
--
-- `modeFeedsSrsSchedule` is true for exactly one of the six study modes. The other
-- five send `p_new_srs: null` and move no schedule at all, so completing a plan
-- item from one of them would mark the day done while leaving every input the
-- planner reads untouched — tomorrow's auto-generated plan would come back
-- identical. Rejected rather than silently allowed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_plan_study_rating(
  -- apply_study_rating's contract, verbatim
  p_event_id            uuid,
  p_client_session_id   uuid,
  p_card_id             uuid,
  p_deck_id             uuid,
  p_rating              text,
  p_srs_source          text,
  -- record_answer_attempt's plan half
  p_client_attempt_id   uuid,
  p_goal_id             uuid,
  p_plan_item_id        uuid,
  p_activity_type       text,
  p_response_type       text,
  p_evaluator_type      text,
  p_expected_revision   bigint  DEFAULT NULL,
  p_new_srs             jsonb   DEFAULT NULL,
  p_review_duration_ms  integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_rating   jsonb;
  v_attempt  jsonb;
  v_score    numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_plan_item_id IS NULL OR p_goal_id IS NULL OR p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'goal, plan item and client attempt ids are required' USING errcode = '22023';
  END IF;

  -- The mapping, in one place. Anything outside the four SRS ratings is refused
  -- rather than scored as a miss: a `next`/`viewed` action carries no judgement,
  -- and inventing one would put a number the learner never gave into their history.
  v_score := CASE p_rating
    WHEN 'again' THEN 0.0
    WHEN 'hard'  THEN 0.5
    WHEN 'good'  THEN 1.0
    WHEN 'easy'  THEN 1.0
    ELSE NULL
  END;
  IF v_score IS NULL THEN
    RAISE EXCEPTION 'Plan study accepts only the SRS ratings (again/hard/good/easy)'
      USING errcode = '22023';
  END IF;

  -- Schedule first. It is the half with optimistic concurrency (PT409 on a stale
  -- revision), so letting it decide before anything is written to the plan means a
  -- conflict leaves the plan row untouched rather than needing to be walked back.
  v_rating := public.apply_study_rating(
    p_event_id           => p_event_id,
    p_client_session_id  => p_client_session_id,
    p_card_id            => p_card_id,
    p_deck_id            => p_deck_id,
    p_study_mode         => 'srs',
    p_rating             => p_rating,
    p_srs_source         => p_srs_source,
    p_expected_revision  => p_expected_revision,
    p_new_srs            => p_new_srs,
    p_review_duration_ms => p_review_duration_ms
  );

  -- Then the plan. `record_answer_attempt` asserts the attempt's targets against
  -- the plan item's own snapshot and raises P0007 on any mismatch, so the three
  -- type fields are passed through from the row the client is showing rather than
  -- guessed here.
  --
  -- `duration_ms` is finally a real number. Both plan screens sent 0, so
  -- daily_plans.completed_minutes has never been incremented by a single minute in
  -- production; the study session has measured per-card duration all along.
  v_attempt := public.record_answer_attempt(
    p_client_attempt_id => p_client_attempt_id,
    p_activity_type     => p_activity_type,
    p_response_type     => p_response_type,
    p_evaluator_type    => p_evaluator_type,
    p_response          => jsonb_build_object('self_rated', v_score, 'srs_rating', p_rating),
    p_goal_id           => p_goal_id,
    p_activity_id       => NULL,
    p_card_id           => p_card_id,
    p_plan_item_id      => p_plan_item_id,
    p_normalized_score  => v_score,
    p_duration_ms       => COALESCE(p_review_duration_ms, 0)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'rating', v_rating,
    'attempt', v_attempt,
    'normalized_score', v_score
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_plan_study_rating(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_plan_study_rating(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer
) TO authenticated;

COMMENT ON FUNCTION public.apply_plan_study_rating(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer
) IS
  'One SRS rating from inside a daily plan: reschedules the card and completes the plan item in a single transaction. Calls apply_study_rating and record_answer_attempt rather than copying either.';
