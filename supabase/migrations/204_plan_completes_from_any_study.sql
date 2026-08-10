-- ============================================================================
-- 204: studying a card finishes its plan item, whichever screen you studied from
--
-- ── The bug, and why it makes the plan lie ──────────────────────────────────
--
-- Migration 187 married the two universes — one rating that both reschedules the
-- card and completes the plan item — but only for a caller that NAMES the plan
-- item. The client picks the path:
--
--   study-store.ts:1000   planItem && config.planSelection && isSrsPersist
--                           ? apply_plan_study_rating   (plan item completed)
--                           : apply_study_rating        (plan item untouched)
--
-- and `config.planSelection` is set only when the study screen was opened from the
-- plan, carrying `goalId` + `planDate` in the URL. Open the SAME card from `/decks`
-- — the most obvious path in the app — and the schedule moves while the plan item
-- stays `pending`.
--
-- What the learner then sees is not a cosmetic drift. It compounds:
--
--   * tomorrow's plan still lists the card, so the day never shrinks;
--   * `daily_plans.completed_items` stays 0, so adherence reads ~0%;
--   * goal-completion divides the estimate by that adherence, so the finish date
--     moves FURTHER AWAY the more diligently the learner studies;
--   * `학습 시작` re-serves cards already reviewed today and advances their
--     intervals a second time.
--
-- Every one of those is worse for the learner who studies more. Any coach — human
-- or model — reading adherence would confidently tell the most diligent user to
-- slow down. That is why this lands before any AI feature that reads the plan.
--
-- ── Why the fix is here and not in the client ───────────────────────────────
--
-- The alternative is to thread `goalId`/`planDate` through every entry point that
-- can start a study session. There are several, they are exactly the kind of thing
-- that drifts, and a missed one fails silently in the direction described above.
-- The server already knows everything needed: the card, the learner, and which
-- plan item is pending today. Doing the join once, in the transaction that is
-- already writing the rating, cannot be forgotten by a caller.
--
-- ── What it deliberately will NOT complete ──────────────────────────────────
--
-- Only items an SRS rating can honestly satisfy:
--
--   * `p_new_srs IS NOT NULL` — 187's thesis, kept. Five of the six study modes
--     move no schedule; completing a day from one of them would mark it done while
--     leaving every input the planner reads untouched.
--   * `evaluator_type = 'self_rate'` — an SRS rating IS a self-rating. Flipping a
--     typed-answer or AI-graded item on the strength of "I knew it" would record a
--     measurement that never happened, which is the exact failure this codebase
--     spends its effort avoiding elsewhere.
--   * `status = 'pending'` — never re-completes, never overwrites a skip.
--
-- ── The day boundary ────────────────────────────────────────────────────────
--
-- `daily_plans.timezone` is the learner's own zone, so "today" is computed in it
-- rather than in UTC. A KST learner studying at 08:00 local is on today's plan, not
-- yesterday's — server `CURRENT_DATE` would have said otherwise for nine hours a day.
--
-- ── Signature change ────────────────────────────────────────────────────────
--
-- `apply_study_rating` gains `p_complete_plan_item boolean DEFAULT true`, and the
-- old 10-argument form is DROPPED rather than left beside it: two overloads that
-- differ only by a defaulted trailing parameter make every existing 10-arg call
-- ambiguous. `apply_plan_study_rating` passes `false` — it names the item itself
-- and calls `record_answer_attempt` directly, so auto-completion there would try to
-- complete the same row twice.
-- ============================================================================

BEGIN;

-- ── 0) The rating body, moved behind a private name, byte-for-byte ──────────
--
-- Extracted verbatim from migration 162 so that the wrapper below can add the plan
-- half WITHOUT a second copy of "how a rating is applied" existing anywhere. That
-- was 187's rule and it still holds: the thing that rots is a copy, and there is none.
CREATE OR REPLACE FUNCTION public._apply_study_rating_core(
  p_event_id uuid,
  p_client_session_id uuid,
  p_card_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_rating text,
  p_srs_source text,
  p_expected_revision bigint DEFAULT NULL,
  p_new_srs jsonb DEFAULT NULL,
  p_review_duration_ms integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.study_rating_events;
  v_previous jsonb;
  v_applied_revision bigint;
  v_session_sequence bigint;
  v_inserted boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_event_id IS NULL OR p_client_session_id IS NULL OR p_card_id IS NULL OR p_deck_id IS NULL THEN
    RAISE EXCEPTION 'event, session, card, and deck ids are required' USING errcode = '22023';
  END IF;
  IF p_study_mode NOT IN ('srs','sequential_review','random','sequential','by_date','cramming') THEN
    RAISE EXCEPTION 'Invalid study mode' USING errcode = '22023';
  END IF;
  IF (p_study_mode = 'srs' AND p_rating NOT IN ('again','hard','good','easy'))
     OR (p_study_mode = 'sequential_review' AND p_rating NOT IN ('known','unknown'))
     OR (p_study_mode IN ('random','sequential','by_date') AND p_rating <> 'next')
     OR (p_study_mode = 'cramming' AND p_rating NOT IN ('got_it','missed')) THEN
    RAISE EXCEPTION 'Invalid rating for study mode' USING errcode = '22023';
  END IF;
  IF p_review_duration_ms IS NOT NULL AND p_review_duration_ms < 0 THEN
    RAISE EXCEPTION 'Invalid review duration' USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_session_id::text, 160));

  SELECT * INTO v_existing FROM public.study_rating_events WHERE id = p_event_id;
  IF FOUND THEN
    IF v_existing.user_id <> v_uid
       OR v_existing.session_id <> p_client_session_id
       OR v_existing.card_id <> p_card_id
       OR v_existing.deck_id <> p_deck_id
       OR v_existing.study_mode <> p_study_mode
       OR v_existing.rating <> p_rating
       OR v_existing.srs_source <> p_srs_source
       OR v_existing.expected_revision IS DISTINCT FROM p_expected_revision
       OR v_existing.new_srs IS DISTINCT FROM p_new_srs
       OR v_existing.review_duration_ms IS DISTINCT FROM p_review_duration_ms THEN
      RAISE EXCEPTION 'Rating event id already used with different payload' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id', v_existing.id,
      'status', v_existing.status,
      'session_sequence', v_existing.session_sequence,
      'applied_revision', v_existing.applied_revision,
      'previous_srs', v_existing.previous_srs,
      'new_srs', v_existing.new_srs
    );
  END IF;

  -- (P6) A finalized session rejects late applies: the aggregate is already computed
  -- and would silently miss them. A session that undo_study_rating REOPENED is the one
  -- exception — the user is back in the session and expected to re-rate the card.
  -- refresh_study_session recomputes the aggregate and closes it again.
  IF EXISTS (
    SELECT 1 FROM public.study_sessions s
    WHERE s.user_id = v_uid AND s.client_session_id = p_client_session_id
      AND COALESCE(s.metadata->'study_persistence'->>'status', 'finalized') <> 'reopened'
  ) THEN
    RAISE EXCEPTION 'Study session is already closed' USING errcode = '55000';
  END IF;

  SELECT COALESCE(max(e.session_sequence), 0) + 1
    INTO v_session_sequence
    FROM public.study_rating_events e
    WHERE e.user_id = v_uid AND e.session_id = p_client_session_id;

  IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.deck_id = p_deck_id) THEN
    RAISE EXCEPTION 'Card does not belong to deck' USING errcode = 'P0002';
  END IF;

  IF p_srs_source = 'embedded' THEN
    IF p_study_mode <> 'srs' OR p_expected_revision IS NULL OR p_new_srs IS NULL THEN
      RAISE EXCEPTION 'Embedded SRS apply requires revision and new state' USING errcode = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.user_id = v_uid) THEN
      RAISE EXCEPTION 'Card is not owned by caller' USING errcode = '42501';
    END IF;
  ELSIF p_srs_source = 'progress_table' THEN
    IF p_study_mode <> 'srs' OR p_expected_revision IS NULL OR p_new_srs IS NULL THEN
      RAISE EXCEPTION 'Progress SRS apply requires revision and new state' USING errcode = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.deck_shares ds
      WHERE ds.deck_id = p_deck_id AND ds.recipient_id = v_uid
        AND ds.status = 'active' AND ds.share_mode = 'subscribe'
    ) THEN
      RAISE EXCEPTION 'No active subscription for progress source' USING errcode = '42501';
    END IF;
  ELSIF p_srs_source = 'none' THEN
    IF p_study_mode = 'srs' OR p_expected_revision IS NOT NULL OR p_new_srs IS NOT NULL THEN
      RAISE EXCEPTION 'Log-only rating cannot carry SRS state' USING errcode = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.user_id = v_uid
      UNION ALL
      SELECT 1 FROM public.deck_shares ds
      WHERE ds.deck_id = p_deck_id AND ds.recipient_id = v_uid AND ds.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Card is not accessible to caller' USING errcode = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid SRS source' USING errcode = '22023';
  END IF;

  IF p_srs_source <> 'none' THEN
    IF jsonb_typeof(p_new_srs) <> 'object'
       OR (p_new_srs - ARRAY['srs_status','ease_factor','interval_days','repetitions','next_review_at','last_reviewed_at']) <> '{}'::jsonb
       OR NOT (p_new_srs ?& ARRAY['srs_status','ease_factor','interval_days','repetitions','next_review_at','last_reviewed_at'])
       OR jsonb_typeof(p_new_srs->'srs_status') <> 'string'
       OR jsonb_typeof(p_new_srs->'ease_factor') <> 'number'
       OR jsonb_typeof(p_new_srs->'interval_days') <> 'number'
       OR jsonb_typeof(p_new_srs->'repetitions') <> 'number'
       OR jsonb_typeof(p_new_srs->'next_review_at') <> 'string'
       OR jsonb_typeof(p_new_srs->'last_reviewed_at') <> 'string'
       OR p_new_srs->>'srs_status' NOT IN ('new','learning','review','suspended') THEN
      RAISE EXCEPTION 'Invalid SRS state payload' USING errcode = '22023';
    END IF;
    BEGIN
      IF (p_new_srs->>'ease_factor')::real < 1.3
         OR (p_new_srs->>'interval_days')::numeric <> trunc((p_new_srs->>'interval_days')::numeric)
         OR (p_new_srs->>'repetitions')::numeric <> trunc((p_new_srs->>'repetitions')::numeric)
         OR (p_new_srs->>'interval_days')::integer < 0
         OR (p_new_srs->>'repetitions')::integer < 0 THEN
        RAISE EXCEPTION 'Invalid SRS state payload' USING errcode = '22023';
      END IF;
      PERFORM (p_new_srs->>'next_review_at')::timestamptz;
      PERFORM (p_new_srs->>'last_reviewed_at')::timestamptz;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range
        OR datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'Invalid SRS state payload' USING errcode = '22023';
    END;

    IF p_srs_source = 'embedded' THEN
      SELECT jsonb_build_object(
        'srs_status', c.srs_status, 'ease_factor', c.ease_factor,
        'interval_days', c.interval_days, 'repetitions', c.repetitions,
        'next_review_at', c.next_review_at, 'last_reviewed_at', c.last_reviewed_at
      ), c.srs_revision
      INTO v_previous, v_applied_revision
      FROM public.cards c WHERE c.id = p_card_id FOR UPDATE;
    ELSE
      SELECT jsonb_build_object(
        'srs_status', u.srs_status, 'ease_factor', u.ease_factor,
        'interval_days', u.interval_days, 'repetitions', u.repetitions,
        'next_review_at', u.next_review_at, 'last_reviewed_at', u.last_reviewed_at
      ), u.srs_revision
      INTO v_previous, v_applied_revision
      FROM public.user_card_progress u
      WHERE u.user_id = v_uid AND u.card_id = p_card_id AND u.deck_id = p_deck_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Progress row not found' USING errcode = 'P0002';
      END IF;
    END IF;

    IF v_applied_revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Stale SRS revision: expected %, current %', p_expected_revision, v_applied_revision
        USING errcode = 'PT409';
    END IF;
    v_applied_revision := v_applied_revision + 1;

    IF p_srs_source = 'embedded' THEN
      UPDATE public.cards SET
        srs_status = p_new_srs->>'srs_status',
        ease_factor = (p_new_srs->>'ease_factor')::real,
        interval_days = (p_new_srs->>'interval_days')::integer,
        repetitions = (p_new_srs->>'repetitions')::integer,
        next_review_at = (p_new_srs->>'next_review_at')::timestamptz,
        last_reviewed_at = (p_new_srs->>'last_reviewed_at')::timestamptz,
        srs_revision = v_applied_revision
      WHERE id = p_card_id;
    ELSE
      UPDATE public.user_card_progress SET
        srs_status = p_new_srs->>'srs_status',
        ease_factor = (p_new_srs->>'ease_factor')::real,
        interval_days = (p_new_srs->>'interval_days')::integer,
        repetitions = (p_new_srs->>'repetitions')::integer,
        next_review_at = (p_new_srs->>'next_review_at')::timestamptz,
        last_reviewed_at = (p_new_srs->>'last_reviewed_at')::timestamptz,
        srs_revision = v_applied_revision,
        updated_at = now()
      WHERE user_id = v_uid AND card_id = p_card_id;
    END IF;
  ELSE
    v_previous := NULL;
    v_applied_revision := NULL;
  END IF;

  INSERT INTO public.study_rating_events (
    id,user_id,session_id,session_sequence,card_id,deck_id,study_mode,rating,srs_source,
    expected_revision,applied_revision,previous_srs,new_srs,review_duration_ms
  ) VALUES (
    p_event_id,v_uid,p_client_session_id,v_session_sequence,p_card_id,p_deck_id,p_study_mode,p_rating,p_srs_source,
    p_expected_revision,v_applied_revision,v_previous,p_new_srs,p_review_duration_ms
  ) ON CONFLICT (id) DO NOTHING RETURNING true INTO v_inserted;

  IF NOT COALESCE(v_inserted, false) THEN
    RAISE EXCEPTION 'Rating event id concurrently used by another session' USING errcode = '23505';
  END IF;

  INSERT INTO public.study_logs (
    user_id,card_id,deck_id,study_mode,rating,
    prev_interval,new_interval,prev_ease,new_ease,review_duration_ms,prev_srs_status,rating_event_id
  ) VALUES (
    v_uid,p_card_id,p_deck_id,p_study_mode,p_rating,
    (v_previous->>'interval_days')::integer,
    COALESCE((p_new_srs->>'interval_days')::integer, (v_previous->>'interval_days')::integer),
    (v_previous->>'ease_factor')::real,
    COALESCE((p_new_srs->>'ease_factor')::real, (v_previous->>'ease_factor')::real),
    p_review_duration_ms,v_previous->>'srs_status',p_event_id
  );

  RETURN jsonb_build_object(
    'event_id', p_event_id, 'status', 'applied', 'session_sequence', v_session_sequence,
    'applied_revision', v_applied_revision,
    'previous_srs', v_previous, 'new_srs', p_new_srs
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public._apply_study_rating_core(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- The old public 10-argument form goes. Leaving it beside the new 11-argument one
-- would make every existing 10-arg call ambiguous, since the new parameter defaults.
DROP FUNCTION IF EXISTS public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer);

-- ── 1) The resolver: which plan item, if any, does this rating finish? ───────
--
-- Split out so the rule is stated once and can be tested on its own. STABLE and
-- read-only; it decides nothing about writing.
CREATE OR REPLACE FUNCTION public._pending_plan_item_for_card(
  p_user_id uuid,
  p_card_id uuid
) RETURNS TABLE (
  item_id       uuid,
  goal_id       uuid,
  activity_type text,
  response_type text,
  evaluator_type text
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.id, p.goal_id, i.activity_type, i.response_type, i.evaluator_type
    FROM daily_plan_items i
    JOIN daily_plans p ON p.id = i.plan_id
   WHERE p.user_id = p_user_id
     AND i.card_id = p_card_id
     AND i.status = 'pending'
     -- The learner's own day, not the server's. `timezone` is written by the
     -- planner from the device calendar.
     AND p.plan_date = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
     -- An SRS rating is a self-rating. It may not stand in for a typed answer or
     -- an AI grade.
     AND i.evaluator_type = 'self_rate'
   ORDER BY i.position
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public._pending_plan_item_for_card(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) apply_study_rating, with the plan half attached ──────────────────────
CREATE OR REPLACE FUNCTION public.apply_study_rating(
  p_event_id uuid,
  p_client_session_id uuid,
  p_card_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_rating text,
  p_srs_source text,
  p_expected_revision bigint DEFAULT NULL,
  p_new_srs jsonb DEFAULT NULL,
  p_review_duration_ms integer DEFAULT NULL,
  p_complete_plan_item boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_item record;
  v_score numeric;
BEGIN
  -- The rating itself is unchanged and is NOT reimplemented here. `_apply_study_rating_core`
  -- holds the body that 160/162 built; this wrapper only adds the plan half.
  v_result := public._apply_study_rating_core(
    p_event_id, p_client_session_id, p_card_id, p_deck_id, p_study_mode,
    p_rating, p_srs_source, p_expected_revision, p_new_srs, p_review_duration_ms);

  IF NOT COALESCE(p_complete_plan_item, true) THEN
    RETURN v_result;
  END IF;
  -- No schedule moved → no day completed. See the header.
  IF p_new_srs IS NULL THEN
    RETURN v_result;
  END IF;

  -- Same map as 187, and deliberately the same numbers: a rating must not mean one
  -- thing when the learner came from the plan and another when they came from a deck.
  v_score := CASE p_rating
    WHEN 'again' THEN 0.0
    WHEN 'hard'  THEN 0.5
    WHEN 'good'  THEN 1.0
    WHEN 'easy'  THEN 1.0
    ELSE NULL
  END;
  IF v_score IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT * INTO v_item FROM public._pending_plan_item_for_card(v_uid, p_card_id);
  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  -- `p_event_id` is unique per rating and already the idempotency key for the rating
  -- event, so reusing it as the client attempt id makes a retried rating reuse its
  -- attempt instead of recording a second one.
  PERFORM public.record_answer_attempt(
    p_client_attempt_id => p_event_id,
    p_activity_type     => v_item.activity_type,
    p_response_type     => v_item.response_type,
    p_evaluator_type    => v_item.evaluator_type,
    p_response          => jsonb_build_object('self_rated', v_score, 'srs_rating', p_rating),
    p_goal_id           => v_item.goal_id,
    p_activity_id       => NULL,
    p_card_id           => p_card_id,
    p_plan_item_id      => v_item.item_id,
    p_normalized_score  => v_score,
    p_duration_ms       => COALESCE(p_review_duration_ms, 0)
  );

  -- Reported so a client can tell the difference between "rated" and "rated, and it
  -- finished today's item" without a second round trip.
  RETURN v_result || jsonb_build_object('completed_plan_item_id', v_item.item_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean) IS
  'Apply an SRS rating and, unless told not to, complete the pending self-rated plan item for that card in the learner''s own today. Studying from a deck used to leave the plan pending, which made adherence read ~0% and pushed the projected finish date further away the more the learner studied.';

-- ── 3) The plan path stands down from auto-completion ───────────────────────
--
-- Recreated verbatim from 187 apart from the one new argument. It still calls the
-- public `apply_study_rating` rather than the private core, so there remains exactly
-- one answer to "what does applying a rating do".
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
    p_review_duration_ms => p_review_duration_ms,
    -- 204: this function names the item and calls `record_answer_attempt` itself just
    -- below, so the rating's own auto-completion must stand down or the same row is
    -- completed twice.
    p_complete_plan_item => false
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

COMMIT;
