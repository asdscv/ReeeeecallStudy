-- 162 rollback. Reverts BOTH halves together, in the reverse order they were
-- added: restore the strict apply guard first, then drop refresh_study_session.
-- Safe only once no client calls refresh_study_session — without it a session
-- reopened by undo_study_rating keeps the aggregate of the discarded attempt AND
-- the cursor undo rewound, so revert the client change together with this script.

-- ── 1) apply_study_rating: back to rejecting ANY rating on an existing session row
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

  IF EXISTS (
    SELECT 1 FROM public.study_sessions s
    WHERE s.user_id = v_uid AND s.client_session_id = p_client_session_id
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

-- ── 2) drop refresh_study_session ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.refresh_study_session(uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.refresh_study_session(uuid,jsonb,jsonb,jsonb);
