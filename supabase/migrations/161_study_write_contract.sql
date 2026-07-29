-- ============================================================================
-- 161: Study write contract (contract phase of expand → cutover → contract)
--
-- Migration 160 made rating persistence atomic and idempotent; P5B moved every
-- client write onto those RPCs. Until now the guarantee was a convention: the
-- table grants still let an authenticated client bypass the RPCs and write SRS
-- state, logs, sessions, and cursors directly, defeating revision checks,
-- server-side aggregation, and the rating-event ledger.
--
-- This migration closes those paths. Table-wide UPDATE is NOT removed — card
-- editing and batch-size tuning stay client-side — so the revokes are
-- COLUMN-LEVEL and re-grant exactly the columns clients still own.
--
-- Two legitimate direct writes are moved onto RPCs first (they would otherwise
-- break): cramming session metadata and per-card SRS reset.
-- ============================================================================

-- ── 1) finalize_study_session gains client metadata ─────────────────────────
-- study_sessions INSERT/UPDATE is revoked below, so the cramming analytics that
-- the client merged with a follow-up UPDATE must travel inside the same
-- transaction. metadata.study_persistence stays server-owned: client keys are
-- merged UNDER it and can never overwrite it.
-- p_metadata carries a DEFAULT, so a P5B client that still sends only six named
-- arguments resolves to this function unchanged. Keeping a separate six-argument
-- overload would make those calls ambiguous ("function is not unique"), so the
-- narrower signature is dropped instead.
DROP FUNCTION IF EXISTS public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb);

CREATE OR REPLACE FUNCTION public.finalize_study_session(
  p_client_session_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_started_at timestamptz,
  p_cursor_before jsonb DEFAULT NULL,
  p_cursor_after jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
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
  v_client_metadata jsonb;
  v_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_client_session_id IS NULL OR p_deck_id IS NULL OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'Session, deck, and started_at are required' USING errcode = '22023';
  END IF;
  IF p_study_mode NOT IN ('srs','sequential_review','random','sequential','by_date','cramming') THEN
    RAISE EXCEPTION 'Invalid study mode' USING errcode = '22023';
  END IF;
  IF p_metadata IS NOT NULL AND jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Session metadata must be an object' USING errcode = '22023';
  END IF;

  -- study_persistence is the server's record of the cursor contract; a client must
  -- not be able to forge or clobber it.
  v_client_metadata := COALESCE(p_metadata, '{}'::jsonb) - 'study_persistence';

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_session_id::text, 160));
  SELECT * INTO v_existing FROM public.study_sessions
    WHERE user_id = v_uid AND client_session_id = p_client_session_id FOR UPDATE;
  IF FOUND THEN
    -- Idempotent retry: compare the contract fields only. Client analytics are
    -- advisory and must not turn a retry into a conflict.
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

  v_metadata := v_client_metadata || jsonb_build_object('study_persistence',jsonb_build_object(
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

-- ── 2) reset_card_srs replaces the direct SRS reset UPDATE ──────────────────
CREATE OR REPLACE FUNCTION public.reset_card_srs(p_card_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deck_id uuid;
  v_owner uuid;
  v_revision bigint;
  v_source text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_card_id IS NULL THEN RAISE EXCEPTION 'Card id is required' USING errcode = '22023'; END IF;

  SELECT c.deck_id, c.user_id INTO v_deck_id, v_owner FROM public.cards c WHERE c.id = p_card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found' USING errcode = 'P0002'; END IF;

  IF v_owner = v_uid THEN
    v_source := 'embedded';
  ELSIF EXISTS (
    SELECT 1 FROM public.deck_shares ds
    WHERE ds.deck_id = v_deck_id AND ds.recipient_id = v_uid
      AND ds.status = 'active' AND ds.share_mode = 'subscribe'
  ) THEN
    v_source := 'progress_table';
  ELSE
    RAISE EXCEPTION 'Card is not accessible to caller' USING errcode = '42501';
  END IF;

  IF v_source = 'embedded' THEN
    -- Revision only ever moves forward (mig 160 invariant), so a reset cannot be
    -- mistaken for the state a stale in-flight rating expects.
    SELECT srs_revision INTO v_revision FROM public.cards WHERE id = p_card_id FOR UPDATE;
    v_revision := v_revision + 1;
    UPDATE public.cards SET
      srs_status='new', ease_factor=2.5, interval_days=0, repetitions=0,
      next_review_at=NULL, last_reviewed_at=NULL, srs_revision=v_revision
      WHERE id = p_card_id;
  ELSE
    SELECT srs_revision INTO v_revision FROM public.user_card_progress
      WHERE user_id = v_uid AND card_id = p_card_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Progress row not found' USING errcode = 'P0002'; END IF;
    v_revision := v_revision + 1;
    UPDATE public.user_card_progress SET
      srs_status='new', ease_factor=2.5, interval_days=0, repetitions=0,
      next_review_at=NULL, last_reviewed_at=NULL, srs_revision=v_revision,
      updated_at=now()
      WHERE user_id = v_uid AND card_id = p_card_id;
  END IF;

  RETURN jsonb_build_object('card_id',p_card_id,'srs_source',v_source,'applied_revision',v_revision);
END;
$$;

-- ── 3) Drop the superseded log RPC ─────────────────────────────────────────
-- apply_study_rating writes study_logs inside the rating transaction and links the
-- row to its rating event; a standalone log insert can only create orphans.
DROP FUNCTION IF EXISTS public.insert_study_log(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text);

-- ── 4) Function grants ─────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_card_srs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_card_srs(uuid) TO authenticated, service_role;

-- ── 5) Close the direct write paths ────────────────────────────────────────
-- cards: keep content editing, remove SRS + revision writes.
REVOKE UPDATE ON TABLE public.cards FROM anon, authenticated;
GRANT UPDATE (field_values, tags, sort_position, template_id, updated_at)
  ON TABLE public.cards TO authenticated;

-- user_card_progress: every column is SRS state → no client UPDATE at all.
-- INSERT stays: init_subscriber_progress / acquire seeding run as the caller in
-- some paths, and a bare insert cannot forge SRS state (defaults + RLS own-row).
REVOKE UPDATE ON TABLE public.user_card_progress FROM anon, authenticated;

-- study_logs / study_sessions: history is server-written only. SELECT stays so
-- analytics pages keep working.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.study_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.study_sessions FROM anon, authenticated;

-- deck_study_state: cursors belong to finalize_study_session; batch sizes stay
-- client-tunable. INSERT stays for session bootstrap.
REVOKE UPDATE ON TABLE public.deck_study_state FROM anon, authenticated;
GRANT UPDATE (new_batch_size, review_batch_size, updated_at)
  ON TABLE public.deck_study_state TO authenticated;

-- Server/edge paths keep full access.
GRANT ALL ON TABLE public.cards, public.user_card_progress, public.study_logs,
  public.study_sessions, public.deck_study_state TO service_role;
