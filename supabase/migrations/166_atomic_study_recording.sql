-- ============================================================================
-- 166: ATOMIC STUDY RECORDING — rate_card_and_log RPC + idempotency support
--
-- Design: DOCS/TODO/2026-07-29-modular-learning-engine-design.md §8, §21
--
-- Delivers:
--   1. client_rating_id column + partial unique index on study_logs for idempotency.
--   2. rate_card_and_log SECURITY DEFINER RPC — atomic SRS update + study log.
--   3. Hardened grants on existing insert_study_log (revoke PUBLIC/anon).
--
-- Principles:
--   * No existing migration file edited.
--   * Expand-only: new column is nullable, new index is partial.
--   * SRS mode: validates CAS snapshot, updates progress, inserts log atomically.
--   * Non-SRS mode: inserts log only, no progress change.
--   * Stale state → returns {ok:false, code:'STALE_STATE', current_state:...} with
--     NO writes committed.
--   * Duplicate client_rating_id → returns prior result idempotently.
-- ============================================================================

-- ── 1) Add client_rating_id column for idempotency ──────────────────────────
ALTER TABLE study_logs ADD COLUMN IF NOT EXISTS client_rating_id uuid;
ALTER TABLE study_logs ADD COLUMN IF NOT EXISTS client_rating_payload jsonb;

-- Partial unique index: only one log per user per client_rating_id (when present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_logs_client_rating_id
  ON study_logs(user_id, client_rating_id)
  WHERE client_rating_id IS NOT NULL;

-- ── 2) rate_card_and_log RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_card_and_log(
  p_card_id            uuid,
  p_deck_id            uuid,
  p_study_mode         text,
  p_rating             text,
  -- Previous SRS snapshot for CAS (SRS mode only; ignored for non-SRS)
  p_prev_srs_status    text    DEFAULT NULL,
  p_prev_interval      integer DEFAULT NULL,
  p_prev_ease          real    DEFAULT NULL,
  p_prev_repetitions   integer DEFAULT NULL,
  -- New SRS state to write (SRS mode only; ignored for non-SRS)
  p_new_srs_status     text    DEFAULT NULL,
  p_new_interval       integer DEFAULT NULL,
  p_new_ease           real    DEFAULT NULL,
  p_new_repetitions    integer DEFAULT NULL,
  p_new_next_review_at timestamptz DEFAULT NULL,
  -- Timing
  p_duration_ms        integer DEFAULT NULL,
  -- Idempotency
  p_client_rating_id   uuid    DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_deck_owner uuid;
  v_card_owner uuid;
  v_card_created_at timestamptz;
  v_active_threshold timestamptz;
  v_is_srs     boolean;
  v_cur_status text;
  v_cur_interval integer;
  v_cur_ease   real;
  v_cur_reps   integer;
  v_source     text; -- 'cards' or 'user_card_progress'
  v_log_id     uuid;
  v_existing   record;
  v_payload    jsonb;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- ── Mode validation ───────────────────────────────────────────────────────
  IF p_study_mode NOT IN ('srs','sequential_review','random','sequential','by_date','cramming') THEN
    RAISE EXCEPTION 'Invalid study_mode: %', p_study_mode USING ERRCODE = 'P0002';
  END IF;

  -- ── Rating validation ─────────────────────────────────────────────────────
  IF p_rating NOT IN ('again','hard','good','easy','known','unknown','next','viewed','got_it','missed') THEN
    RAISE EXCEPTION 'Invalid rating: %', p_rating USING ERRCODE = 'P0002';
  END IF;

  v_is_srs := (p_study_mode = 'srs');

  IF p_duration_ms IS NOT NULL AND p_duration_ms < 0 THEN
    RAISE EXCEPTION 'duration_ms must be non-negative' USING ERRCODE = 'P0002';
  END IF;

  -- ── SRS bounds validation ─────────────────────────────────────────────────
  IF v_is_srs THEN
    IF p_new_srs_status IS NULL OR p_new_srs_status NOT IN ('new','learning','review','suspended') THEN
      RAISE EXCEPTION 'Invalid new_srs_status for SRS mode' USING ERRCODE = 'P0002';
    END IF;
    IF p_new_interval IS NULL OR p_new_interval < 0 THEN
      RAISE EXCEPTION 'new_interval must be non-negative' USING ERRCODE = 'P0002';
    END IF;
    IF p_new_ease IS NULL OR p_new_ease < 1.0 OR p_new_ease > 5.0 THEN
      RAISE EXCEPTION 'new_ease must be between 1.0 and 5.0' USING ERRCODE = 'P0002';
    END IF;
    IF p_new_repetitions IS NULL OR p_new_repetitions < 0 THEN
      RAISE EXCEPTION 'new_repetitions must be non-negative' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- ── Idempotency: serialize and compare the complete client payload ─────────
  v_payload := jsonb_build_object(
    'card_id', p_card_id, 'deck_id', p_deck_id, 'study_mode', p_study_mode, 'rating', p_rating,
    'prev_srs_status', p_prev_srs_status, 'prev_interval', p_prev_interval,
    'prev_ease', p_prev_ease, 'prev_repetitions', p_prev_repetitions,
    'new_srs_status', p_new_srs_status, 'new_interval', p_new_interval,
    'new_ease', p_new_ease, 'new_repetitions', p_new_repetitions,
    'new_next_review_at', p_new_next_review_at, 'duration_ms', p_duration_ms
  );
  IF p_client_rating_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_client_rating_id::text, 0));
    SELECT sl.id, sl.card_id, sl.deck_id, sl.study_mode, sl.rating,
           sl.prev_interval, sl.new_interval, sl.prev_ease, sl.new_ease,
           sl.prev_srs_status, sl.client_rating_payload
      INTO v_existing
      FROM study_logs sl
     WHERE sl.user_id = v_uid
       AND sl.client_rating_id = p_client_rating_id;

    IF FOUND THEN
      IF (v_existing.client_rating_payload IS NOT NULL AND v_existing.client_rating_payload IS DISTINCT FROM v_payload)
         OR (v_existing.client_rating_payload IS NULL AND (
           v_existing.card_id IS DISTINCT FROM p_card_id
           OR v_existing.deck_id IS DISTINCT FROM p_deck_id
           OR v_existing.study_mode IS DISTINCT FROM p_study_mode
           OR v_existing.rating IS DISTINCT FROM p_rating
         )) THEN
        RAISE EXCEPTION 'client_rating_id was reused with a different rating payload'
          USING ERRCODE = 'P0007';
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'log_id', v_existing.id,
        'source', 'prior'
      );
    END IF;
  END IF;

  -- ── Card/deck verification: lock card row ─────────────────────────────────
  SELECT c.user_id, c.created_at INTO v_card_owner, v_card_created_at
    FROM cards c
   WHERE c.id = p_card_id
     AND c.deck_id = p_deck_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card does not belong to specified deck' USING ERRCODE = 'P0003';
  END IF;

  -- ── Deck ownership / entitlement ──────────────────────────────────────────
  SELECT d.user_id INTO v_deck_owner
    FROM decks d
   WHERE d.id = p_deck_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deck not found' USING ERRCODE = 'P0003';
  END IF;

  IF v_card_owner IS DISTINCT FROM v_deck_owner THEN
    RAISE EXCEPTION 'Card owner does not match deck owner' USING ERRCODE = 'P0003';
  END IF;

  IF v_deck_owner = v_uid THEN
    -- Caller owns both deck and card. Preserve the owned-card study lock.
    v_active_threshold := public.get_active_card_threshold();
    IF v_active_threshold IS NOT NULL
       AND v_card_created_at > v_active_threshold
       AND (
         COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false)
         OR NOT EXISTS (SELECT 1 FROM official_deck_manifest WHERE deck_id = p_deck_id)
       ) THEN
      RAISE EXCEPTION 'Card is study-locked (over card limit)' USING ERRCODE = 'P0005';
    END IF;
    v_source := 'cards';
  ELSE
    -- Caller must have an active subscribe share
    IF NOT EXISTS (
      SELECT 1 FROM deck_shares ds
       WHERE ds.deck_id = p_deck_id
         AND ds.recipient_id = v_uid
         AND ds.share_mode = 'subscribe'
         AND ds.status = 'active'
    ) THEN
      RAISE EXCEPTION 'No entitlement to study this deck' USING ERRCODE = 'P0004';
    END IF;

    -- Check card-limit active status for subscribed decks
    IF NOT public.is_subscribed_deck_active(p_deck_id) THEN
      RAISE EXCEPTION 'Subscribed deck is study-locked (over card limit)' USING ERRCODE = 'P0005';
    END IF;

    v_source := 'user_card_progress';
  END IF;

  -- ── SRS mode: CAS check and progress update ──────────────────────────────
  IF v_is_srs THEN
    -- Read current authoritative state
    IF v_source = 'cards' THEN
      SELECT c.srs_status, c.interval_days, c.ease_factor, c.repetitions
        INTO v_cur_status, v_cur_interval, v_cur_ease, v_cur_reps
        FROM cards c
       WHERE c.id = p_card_id
         FOR UPDATE; -- already locked above
    ELSE
      -- user_card_progress: upsert scenario, lock if exists
      SELECT ucp.srs_status, ucp.interval_days, ucp.ease_factor, ucp.repetitions
        INTO v_cur_status, v_cur_interval, v_cur_ease, v_cur_reps
        FROM user_card_progress ucp
       WHERE ucp.user_id = v_uid
         AND ucp.card_id = p_card_id
         FOR UPDATE;

      -- If no progress row yet, treat as defaults
      IF NOT FOUND THEN
        v_cur_status   := 'new';
        v_cur_interval := 0;
        v_cur_ease     := 2.5;
        v_cur_reps     := 0;
      END IF;
    END IF;

    -- ── CAS: compare client's previous snapshot with actual ─────────────────
    IF p_prev_srs_status IS DISTINCT FROM v_cur_status
       OR COALESCE(p_prev_interval, 0) IS DISTINCT FROM COALESCE(v_cur_interval, 0)
       OR COALESCE(p_prev_ease, 2.5) IS DISTINCT FROM COALESCE(v_cur_ease, 2.5)
       OR COALESCE(p_prev_repetitions, 0) IS DISTINCT FROM COALESCE(v_cur_reps, 0)
    THEN
      -- Stale state: return conflict WITHOUT any write
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'STALE_STATE',
        'current_state', jsonb_build_object(
          'srs_status', v_cur_status,
          'interval_days', v_cur_interval,
          'ease_factor', v_cur_ease,
          'repetitions', v_cur_reps
        )
      );
    END IF;

    -- ── Update progress atomically ──────────────────────────────────────────
    IF v_source = 'cards' THEN
      UPDATE cards
         SET srs_status     = p_new_srs_status,
             interval_days  = COALESCE(p_new_interval, interval_days),
             ease_factor    = COALESCE(p_new_ease, ease_factor),
             repetitions    = COALESCE(p_new_repetitions, repetitions),
             next_review_at = p_new_next_review_at,
             last_reviewed_at = now()
       WHERE id = p_card_id;
    ELSE
      INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status, interval_days, ease_factor, repetitions, next_review_at, last_reviewed_at)
      VALUES (v_uid, p_card_id, p_deck_id, p_new_srs_status,
              COALESCE(p_new_interval, 0), COALESCE(p_new_ease, 2.5),
              COALESCE(p_new_repetitions, 0), p_new_next_review_at, now())
      ON CONFLICT (user_id, card_id) DO UPDATE SET
        srs_status     = EXCLUDED.srs_status,
        interval_days  = EXCLUDED.interval_days,
        ease_factor    = EXCLUDED.ease_factor,
        repetitions    = EXCLUDED.repetitions,
        next_review_at = EXCLUDED.next_review_at,
        last_reviewed_at = EXCLUDED.last_reviewed_at;
    END IF;
  END IF;

  -- ── Insert study_log ──────────────────────────────────────────────────────
  INSERT INTO study_logs (
    user_id, card_id, deck_id, study_mode, rating,
    prev_interval, new_interval, prev_ease, new_ease,
    review_duration_ms, prev_srs_status, client_rating_id, client_rating_payload
  )
  VALUES (
    v_uid, p_card_id, p_deck_id, p_study_mode, p_rating,
    CASE WHEN v_is_srs THEN v_cur_interval ELSE p_prev_interval END,
    CASE WHEN v_is_srs THEN p_new_interval ELSE p_new_interval END,
    CASE WHEN v_is_srs THEN v_cur_ease ELSE p_prev_ease END,
    CASE WHEN v_is_srs THEN p_new_ease ELSE p_new_ease END,
    p_duration_ms,
    CASE WHEN v_is_srs THEN v_cur_status ELSE p_prev_srs_status END,
    p_client_rating_id,
    v_payload
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'log_id', v_log_id,
    'source', v_source
  );
END;
$$;

-- ── 3) Grants for rate_card_and_log ─────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.rate_card_and_log(
  uuid, uuid, text, text, text, integer, real, integer,
  text, integer, real, integer, timestamptz, integer, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rate_card_and_log(
  uuid, uuid, text, text, text, integer, real, integer,
  text, integer, real, integer, timestamptz, integer, uuid
) TO authenticated;

-- ── 4) Harden existing insert_study_log — revoke from PUBLIC/anon ───────────
-- The function remains for backward compatibility but anon must not call it.
REVOKE EXECUTE ON FUNCTION public.insert_study_log(
  uuid, uuid, uuid, text, text, integer, integer, real, real, integer, text
) FROM PUBLIC, anon;

-- Ensure authenticated still can call it (idempotent grant)
GRANT EXECUTE ON FUNCTION public.insert_study_log(
  uuid, uuid, uuid, text, text, integer, integer, real, real, integer, text
) TO authenticated;
