-- ============================================================================
-- 162: refresh_study_session — re-finalize a session that undo reopened
--
-- finalize_study_session is idempotent per (user, client_session_id): a second
-- call returns the first result. That is what makes retries safe, but it also
-- means a session REOPENED by undo_study_rating can never be corrected by
-- finalizing again. Undoing from the completion screen and re-rating the card
-- therefore left the stored aggregate describing the discarded attempt.
--
-- undo_study_rating also rolls the deck cursor back to the session's
-- cursor_before whenever the session it reopened carried one. So a correct
-- re-finalize has to do three things, all in one transaction:
--   1. recompute the aggregate from the session's `applied` rating events,
--   2. re-advance the cursor to the newly computed cursor_after (guarded by the
--      same staleness comparison finalize uses), and
--   3. flip metadata.study_persistence.status back to `finalized`, recording the
--      cursor pair that actually moved.
--
-- Leaving the cursor alone (the first design) would silently drop a corrected
-- sequential / sequential_review session's progress: undo had already rewound
-- the cursor and nothing would ever move it forward again.
--
-- A refresh is worthless without a re-rating to record, and apply_study_rating
-- rejected every rating once the session row existed (55000). So this migration
-- also carves out the one legitimate case: a session undo left `reopened`.
-- ============================================================================

-- ── 1) apply_study_rating accepts ratings on a REOPENED session ─────────────
-- The guard that rejects a rating once the session row exists is what makes the
-- server aggregate trustworthy — but it also made undo-then-re-rate impossible:
-- undo_study_rating leaves the row in place with status `reopened`, so every
-- follow-up rating failed with 55000 and the correction could never be recorded.
-- Only the `reopened` status is exempted; a finalized session still rejects late
-- applies, and refresh_study_session flips the status back when the user is done.
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

-- ── 2) refresh_study_session ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_study_session(
  p_client_session_id uuid,
  p_cursor_before jsonb DEFAULT NULL,
  p_cursor_after jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.study_sessions;
  v_state public.deck_study_state;
  v_actions integer;
  v_cards integer;
  v_duration bigint;
  v_ratings jsonb;
  v_client_metadata jsonb;
  v_metadata jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_client_session_id IS NULL THEN
    RAISE EXCEPTION 'Client session id is required' USING errcode = '22023';
  END IF;
  IF p_metadata IS NOT NULL AND jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Session metadata must be an object' USING errcode = '22023';
  END IF;

  -- Same lock order as the other study RPCs: session advisory lock, then the
  -- session row, then deck_study_state.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_session_id::text, 160));

  SELECT * INTO v_session FROM public.study_sessions
    WHERE user_id = v_uid AND client_session_id = p_client_session_id
    FOR UPDATE;
  IF NOT FOUND THEN
    -- Also the not-your-session answer: RLS-free SECURITY DEFINER must not leak
    -- whether someone else's session exists.
    RAISE EXCEPTION 'Study session not found' USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.study_rating_events e
    WHERE e.user_id = v_uid AND e.session_id = p_client_session_id
      AND (e.deck_id <> v_session.deck_id OR e.study_mode <> v_session.study_mode)
  ) THEN
    RAISE EXCEPTION 'Session events have inconsistent deck or mode' USING errcode = '22023';
  END IF;

  SELECT count(*)::integer, count(DISTINCT card_id)::integer,
         COALESCE(sum(review_duration_ms),0)::bigint
    INTO v_actions, v_cards, v_duration
    FROM public.study_rating_events
    WHERE user_id = v_uid AND session_id = p_client_session_id AND status = 'applied';
  SELECT COALESCE(jsonb_object_agg(rating, n), '{}'::jsonb) INTO v_ratings
    FROM (SELECT rating, count(*)::integer n FROM public.study_rating_events
          WHERE user_id = v_uid AND session_id = p_client_session_id AND status = 'applied'
          GROUP BY rating) r;

  -- A session whose every rating was undone did not happen. Keeping the row would
  -- put a 0-card, 0-minute session in the user's history and analytics, so it is
  -- discarded instead. The cursor needs no attention here: undo already rewound it
  -- to this session's cursor_before, which is why the cursor payload is ignored on
  -- this path. A later completion under the same session id finalizes a fresh row.
  IF v_actions = 0 THEN
    DELETE FROM public.study_sessions WHERE id = v_session.id;
    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'client_session_id', p_client_session_id,
      'cards_studied', 0,
      'total_cards', 0,
      'total_duration_ms', 0,
      'ratings', '{}'::jsonb,
      'status', 'discarded'
    );
  END IF;

  -- Cursor contract: identical shape rules to finalize_study_session, so a
  -- refresh cannot express a cursor move finalize would have rejected.
  IF v_session.study_mode IN ('sequential','sequential_review') THEN
    IF p_cursor_before IS NULL OR p_cursor_after IS NULL THEN
      RAISE EXCEPTION 'Sequential refresh requires cursor payload' USING errcode = '22023';
    END IF;
    SELECT * INTO v_state FROM public.deck_study_state
      WHERE user_id = v_uid AND deck_id = v_session.deck_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Study state not found' USING errcode = 'P0002'; END IF;

    IF v_session.study_mode = 'sequential' THEN
      IF (p_cursor_before - 'sequential_pos') <> '{}'::jsonb OR (p_cursor_after - 'sequential_pos') <> '{}'::jsonb
         OR NOT (p_cursor_before ? 'sequential_pos') OR NOT (p_cursor_after ? 'sequential_pos') THEN
        RAISE EXCEPTION 'Invalid sequential cursor payload' USING errcode = '22023';
      END IF;
      -- undo_study_rating rewound the cursor to cursor_before; anything else means
      -- another session moved it and this refresh must not overwrite that.
      IF v_state.sequential_pos <> (p_cursor_before->>'sequential_pos')::integer THEN
        RAISE EXCEPTION 'Stale sequential cursor' USING errcode = 'PT409';
      END IF;
      UPDATE public.deck_study_state SET sequential_pos = (p_cursor_after->>'sequential_pos')::integer
        WHERE id = v_state.id;
    ELSE
      IF (p_cursor_before - ARRAY['new_start_pos','review_start_pos']) <> '{}'::jsonb
         OR (p_cursor_after - ARRAY['new_start_pos','review_start_pos']) <> '{}'::jsonb
         OR NOT (p_cursor_before ?& ARRAY['new_start_pos','review_start_pos'])
         OR NOT (p_cursor_after ?& ARRAY['new_start_pos','review_start_pos']) THEN
        RAISE EXCEPTION 'Invalid sequential-review cursor payload' USING errcode = '22023';
      END IF;
      IF v_state.new_start_pos <> (p_cursor_before->>'new_start_pos')::integer
         OR v_state.review_start_pos <> (p_cursor_before->>'review_start_pos')::integer THEN
        RAISE EXCEPTION 'Stale sequential-review cursor' USING errcode = 'PT409';
      END IF;
      UPDATE public.deck_study_state SET
        new_start_pos = (p_cursor_after->>'new_start_pos')::integer,
        review_start_pos = (p_cursor_after->>'review_start_pos')::integer
        WHERE id = v_state.id;
    END IF;
  ELSIF p_cursor_before IS NOT NULL OR p_cursor_after IS NOT NULL THEN
    RAISE EXCEPTION 'Non-sequential refresh cannot carry cursor payload' USING errcode = '22023';
  END IF;

  -- study_persistence stays server-owned. When the client sends no analytics the
  -- keys already on the row are kept rather than dropped.
  v_client_metadata := COALESCE(p_metadata, v_session.metadata, '{}'::jsonb) - 'study_persistence';
  v_metadata := v_client_metadata || jsonb_build_object('study_persistence', jsonb_build_object(
    'status', 'finalized', 'cursor_before', p_cursor_before, 'cursor_after', p_cursor_after));

  UPDATE public.study_sessions SET
    cards_studied = v_actions,
    total_cards = v_cards,
    total_duration_ms = v_duration,
    ratings = v_ratings,
    completed_at = now(),
    metadata = v_metadata
    WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'client_session_id', p_client_session_id,
    'cards_studied', v_actions,
    'total_cards', v_cards,
    'total_duration_ms', v_duration,
    'ratings', v_ratings,
    'status', 'finalized'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_study_session(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_study_session(uuid,jsonb,jsonb,jsonb) TO authenticated, service_role;
