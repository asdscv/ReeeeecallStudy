-- ============================================================================
-- 160: Atomic and idempotent study-rating persistence (expand phase)
-- ============================================================================

-- ── 1) Additive revision / idempotency columns ──────────────────────────────
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS srs_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.user_card_progress
  ADD COLUMN IF NOT EXISTS srs_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.study_logs
  ADD COLUMN IF NOT EXISTS rating_event_id uuid;
ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS client_session_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS study_logs_rating_event_uidx
  ON public.study_logs (rating_event_id) WHERE rating_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_client_session_uidx
  ON public.study_sessions (user_id, client_session_id)
  WHERE client_session_id IS NOT NULL;

-- ── 2) Durable rating-event ledger ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_rating_events (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id         uuid NOT NULL,
  session_sequence   bigint NOT NULL,
  card_id            uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  deck_id            uuid NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  study_mode         text NOT NULL CHECK (study_mode IN
    ('srs','sequential_review','random','sequential','by_date','cramming')),
  rating             text NOT NULL CHECK (rating IN
    ('again','hard','good','easy','known','unknown','next','viewed','got_it','missed')),
  srs_source         text NOT NULL CHECK (srs_source IN ('embedded','progress_table','none')),
  expected_revision  bigint,
  applied_revision   bigint,
  previous_srs       jsonb,
  new_srs            jsonb,
  review_duration_ms integer CHECK (review_duration_ms IS NULL OR review_duration_ms >= 0),
  status             text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  undone_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS study_rating_events_session_sequence_uidx
  ON public.study_rating_events (user_id, session_id, session_sequence);
CREATE INDEX IF NOT EXISTS study_rating_events_user_session_idx
  ON public.study_rating_events (user_id, session_id);
CREATE INDEX IF NOT EXISTS study_rating_events_user_card_created_idx
  ON public.study_rating_events (user_id, card_id, created_at DESC);

ALTER TABLE public.study_rating_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own study rating events" ON public.study_rating_events;
CREATE POLICY "Users read own study rating events"
  ON public.study_rating_events FOR SELECT USING (auth.uid() = user_id);
REVOKE ALL ON TABLE public.study_rating_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.study_rating_events TO authenticated;
GRANT ALL ON TABLE public.study_rating_events TO service_role;

-- ── 3) Legacy-write-compatible revision bump ────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_srs_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.srs_status       IS DISTINCT FROM OLD.srs_status
     OR NEW.ease_factor      IS DISTINCT FROM OLD.ease_factor
     OR NEW.interval_days    IS DISTINCT FROM OLD.interval_days
     OR NEW.repetitions      IS DISTINCT FROM OLD.repetitions
     OR NEW.next_review_at   IS DISTINCT FROM OLD.next_review_at
     OR NEW.last_reviewed_at IS DISTINCT FROM OLD.last_reviewed_at THEN
    IF NEW.srs_revision <= OLD.srs_revision THEN
      NEW.srs_revision := OLD.srs_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_cards_srs_revision ON public.cards;
CREATE TRIGGER bump_cards_srs_revision
  BEFORE UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION public.bump_srs_revision();
DROP TRIGGER IF EXISTS bump_progress_srs_revision ON public.user_card_progress;
CREATE TRIGGER bump_progress_srs_revision
  BEFORE UPDATE ON public.user_card_progress FOR EACH ROW EXECUTE FUNCTION public.bump_srs_revision();

-- ── 4) Atomic rating apply ──────────────────────────────────────────────────
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

-- ── 5) Atomic session finalize ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_study_session(
  p_client_session_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_started_at timestamptz,
  p_cursor_before jsonb DEFAULT NULL,
  p_cursor_after jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.study_sessions;
  v_state public.deck_study_state;
  v_actions integer;
  v_cards integer;
  v_duration bigint;
  v_ratings jsonb;
  v_metadata jsonb;
  v_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_client_session_id IS NULL OR p_deck_id IS NULL OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'Session, deck, and started_at are required' USING errcode = '22023';
  END IF;
  IF p_study_mode NOT IN ('srs','sequential_review','random','sequential','by_date','cramming') THEN
    RAISE EXCEPTION 'Invalid study mode' USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_session_id::text, 160));
  SELECT * INTO v_existing FROM public.study_sessions
    WHERE user_id = v_uid AND client_session_id = p_client_session_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.deck_id <> p_deck_id OR v_existing.study_mode <> p_study_mode
       OR v_existing.started_at <> p_started_at
       OR v_existing.metadata->'study_persistence'->'cursor_before' IS DISTINCT FROM COALESCE(p_cursor_before, 'null'::jsonb)
       OR v_existing.metadata->'study_persistence'->'cursor_after' IS DISTINCT FROM COALESCE(p_cursor_after, 'null'::jsonb) THEN
      RAISE EXCEPTION 'Session id already finalized with different payload' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object('session_id',v_existing.id,'client_session_id',p_client_session_id,
      'cards_studied',v_existing.cards_studied,'total_cards',v_existing.total_cards,
      'total_duration_ms',v_existing.total_duration_ms,'ratings',v_existing.ratings,
      'status',COALESCE(v_existing.metadata->'study_persistence'->>'status','finalized'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.decks d WHERE d.id = p_deck_id AND d.user_id = v_uid
    UNION ALL
    SELECT 1 FROM public.deck_shares ds
    WHERE ds.deck_id = p_deck_id AND ds.recipient_id = v_uid AND ds.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Deck is not accessible to caller' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.study_rating_events e WHERE e.user_id=v_uid AND e.session_id=p_client_session_id
             AND (e.deck_id<>p_deck_id OR e.study_mode<>p_study_mode)) THEN
    RAISE EXCEPTION 'Session events have inconsistent deck or mode' USING errcode = '22023';
  END IF;

  SELECT count(*)::integer, count(DISTINCT card_id)::integer,
         COALESCE(sum(review_duration_ms),0)::bigint
    INTO v_actions,v_cards,v_duration
    FROM public.study_rating_events
    WHERE user_id=v_uid AND session_id=p_client_session_id AND status='applied';
  SELECT COALESCE(jsonb_object_agg(rating,n), '{}'::jsonb) INTO v_ratings
    FROM (SELECT rating,count(*)::integer n FROM public.study_rating_events
          WHERE user_id=v_uid AND session_id=p_client_session_id AND status='applied'
          GROUP BY rating) r;

  IF p_study_mode IN ('sequential','sequential_review') THEN
    IF p_cursor_before IS NULL OR p_cursor_after IS NULL THEN
      RAISE EXCEPTION 'Sequential finalize requires cursor payload' USING errcode = '22023';
    END IF;
    SELECT * INTO v_state FROM public.deck_study_state
      WHERE user_id=v_uid AND deck_id=p_deck_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Study state not found' USING errcode = 'P0002'; END IF;

    IF p_study_mode='sequential' THEN
      IF (p_cursor_before - 'sequential_pos') <> '{}'::jsonb OR (p_cursor_after - 'sequential_pos') <> '{}'::jsonb
         OR NOT (p_cursor_before ? 'sequential_pos') OR NOT (p_cursor_after ? 'sequential_pos') THEN
        RAISE EXCEPTION 'Invalid sequential cursor payload' USING errcode = '22023';
      END IF;
      IF v_state.sequential_pos <> (p_cursor_before->>'sequential_pos')::integer THEN
        RAISE EXCEPTION 'Stale sequential cursor' USING errcode = 'PT409';
      END IF;
      UPDATE public.deck_study_state SET sequential_pos=(p_cursor_after->>'sequential_pos')::integer
        WHERE id=v_state.id;
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
        new_start_pos=(p_cursor_after->>'new_start_pos')::integer,
        review_start_pos=(p_cursor_after->>'review_start_pos')::integer
        WHERE id=v_state.id;
    END IF;
  ELSIF p_cursor_before IS NOT NULL OR p_cursor_after IS NOT NULL THEN
    RAISE EXCEPTION 'Non-sequential finalize cannot carry cursor payload' USING errcode = '22023';
  END IF;

  v_metadata := jsonb_build_object('study_persistence',jsonb_build_object(
    'status','finalized','cursor_before',p_cursor_before,'cursor_after',p_cursor_after));
  INSERT INTO public.study_sessions (
    user_id,deck_id,study_mode,cards_studied,total_cards,total_duration_ms,ratings,
    started_at,completed_at,metadata,client_session_id
  ) VALUES (
    v_uid,p_deck_id,p_study_mode,v_actions,v_cards,v_duration,v_ratings,
    p_started_at,now(),v_metadata,p_client_session_id
  ) RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id',v_session_id,'client_session_id',p_client_session_id,
    'cards_studied',v_actions,'total_cards',v_cards,'total_duration_ms',v_duration,
    'ratings',v_ratings,'status','finalized');
END;
$$;

-- ── 6) Atomic latest-event undo ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.undo_study_rating(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.study_rating_events;
  v_latest uuid;
  v_current_revision bigint;
  v_restored_revision bigint;
  v_session public.study_sessions;
  v_state public.deck_study_state;
  v_before jsonb;
  v_after jsonb;
  v_actions integer;
  v_cards integer;
  v_duration bigint;
  v_ratings jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_event FROM public.study_rating_events WHERE id=p_event_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rating event not found' USING errcode = 'P0002'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_event.session_id::text,160));
  SELECT * INTO v_event FROM public.study_rating_events WHERE id=p_event_id AND user_id=v_uid FOR UPDATE;
  IF v_event.status='undone' THEN
    RETURN jsonb_build_object('event_id',v_event.id,'status','undone',
      'applied_revision',v_event.applied_revision,'previous_srs',v_event.previous_srs);
  END IF;

  SELECT id INTO v_latest FROM public.study_rating_events
    WHERE user_id=v_uid AND session_id=v_event.session_id AND status='applied'
    ORDER BY session_sequence DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Only the latest applied rating can be undone' USING errcode = '55000';
  END IF;

  v_restored_revision := v_event.applied_revision;
  IF v_event.srs_source='embedded' THEN
    SELECT srs_revision INTO v_current_revision FROM public.cards WHERE id=v_event.card_id FOR UPDATE;
    IF v_current_revision <> v_event.applied_revision THEN
      RAISE EXCEPTION 'SRS state changed after rating' USING errcode = 'PT409';
    END IF;
    v_restored_revision := v_current_revision+1;
    UPDATE public.cards SET
      srs_status=v_event.previous_srs->>'srs_status',
      ease_factor=(v_event.previous_srs->>'ease_factor')::real,
      interval_days=(v_event.previous_srs->>'interval_days')::integer,
      repetitions=(v_event.previous_srs->>'repetitions')::integer,
      next_review_at=(v_event.previous_srs->>'next_review_at')::timestamptz,
      last_reviewed_at=(v_event.previous_srs->>'last_reviewed_at')::timestamptz,
      srs_revision=v_restored_revision
      WHERE id=v_event.card_id;
  ELSIF v_event.srs_source='progress_table' THEN
    SELECT srs_revision INTO v_current_revision FROM public.user_card_progress
      WHERE user_id=v_uid AND card_id=v_event.card_id FOR UPDATE;
    IF v_current_revision <> v_event.applied_revision THEN
      RAISE EXCEPTION 'SRS state changed after rating' USING errcode = 'PT409';
    END IF;
    v_restored_revision := v_current_revision+1;
    UPDATE public.user_card_progress SET
      srs_status=v_event.previous_srs->>'srs_status',
      ease_factor=(v_event.previous_srs->>'ease_factor')::real,
      interval_days=(v_event.previous_srs->>'interval_days')::integer,
      repetitions=(v_event.previous_srs->>'repetitions')::integer,
      next_review_at=(v_event.previous_srs->>'next_review_at')::timestamptz,
      last_reviewed_at=(v_event.previous_srs->>'last_reviewed_at')::timestamptz,
      srs_revision=v_restored_revision,updated_at=now()
      WHERE user_id=v_uid AND card_id=v_event.card_id;
  END IF;

  DELETE FROM public.study_logs WHERE rating_event_id=p_event_id AND user_id=v_uid;
  UPDATE public.study_rating_events SET status='undone',undone_at=now(),updated_at=now(),
    applied_revision=v_restored_revision WHERE id=p_event_id;

  SELECT * INTO v_session FROM public.study_sessions
    WHERE user_id=v_uid AND client_session_id=v_event.session_id FOR UPDATE;
  IF FOUND THEN
    v_before := v_session.metadata->'study_persistence'->'cursor_before';
    v_after := v_session.metadata->'study_persistence'->'cursor_after';
    IF v_before IS NOT NULL AND v_before <> 'null'::jsonb THEN
      SELECT * INTO v_state FROM public.deck_study_state
        WHERE user_id=v_uid AND deck_id=v_event.deck_id FOR UPDATE;
      IF v_event.study_mode='sequential' THEN
        IF v_state.sequential_pos <> (v_after->>'sequential_pos')::integer THEN
          RAISE EXCEPTION 'Cursor changed after session finalize' USING errcode='PT409';
        END IF;
        UPDATE public.deck_study_state SET sequential_pos=(v_before->>'sequential_pos')::integer WHERE id=v_state.id;
      ELSIF v_event.study_mode='sequential_review' THEN
        IF v_state.new_start_pos <> (v_after->>'new_start_pos')::integer
           OR v_state.review_start_pos <> (v_after->>'review_start_pos')::integer THEN
          RAISE EXCEPTION 'Cursor changed after session finalize' USING errcode='PT409';
        END IF;
        UPDATE public.deck_study_state SET new_start_pos=(v_before->>'new_start_pos')::integer,
          review_start_pos=(v_before->>'review_start_pos')::integer WHERE id=v_state.id;
      END IF;
    END IF;

    SELECT count(*)::integer,count(DISTINCT card_id)::integer,COALESCE(sum(review_duration_ms),0)::bigint
      INTO v_actions,v_cards,v_duration FROM public.study_rating_events
      WHERE user_id=v_uid AND session_id=v_event.session_id AND status='applied';
    SELECT COALESCE(jsonb_object_agg(rating,n),'{}'::jsonb) INTO v_ratings
      FROM (SELECT rating,count(*)::integer n FROM public.study_rating_events
            WHERE user_id=v_uid AND session_id=v_event.session_id AND status='applied' GROUP BY rating) r;
    UPDATE public.study_sessions SET cards_studied=v_actions,total_cards=v_cards,
      total_duration_ms=v_duration,ratings=v_ratings,
      metadata=jsonb_set(metadata,'{study_persistence,status}','"reopened"'::jsonb,true)
      WHERE id=v_session.id;
  END IF;

  RETURN jsonb_build_object('event_id',v_event.id,'status','undone',
    'applied_revision',v_restored_revision,'previous_srs',v_event.previous_srs);
END;
$$;

-- ── 7) RPC execution grants ────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.apply_study_rating(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_study_rating(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_study_rating(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_study_rating(uuid) TO authenticated, service_role;

-- Supabase CLI >=2.107 does not auto-grant DML to service_role on fresh reset.
-- Keep server/test verification deterministic without widening client access.
GRANT SELECT ON TABLE public.cards, public.user_card_progress, public.study_logs,
  public.study_sessions, public.deck_study_state, public.decks, public.deck_shares,
  public.marketplace_listings TO service_role;
