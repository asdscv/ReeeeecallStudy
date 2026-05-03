-- ============================================================================
-- Migration 081 — Marketplace Acquire Atomicity & Idempotency
-- 표준 준거: DOCS/DESIGN/MARKETPLACE_ACQUIRE/DESIGN.md
--          DOCS/STANDARD/04_DATABASE, 06_RESILIENCE
--
-- Goals:
--   D1) deck_shares partial UNIQUE — recipient_id+deck_id+share_mode WHERE active
--   D2) acquire_listing RPC — single transaction (atomic)
--   D3) explicit error codes (P0001/P0002) for client branching
--   D4) idempotent — repeat call returns existing deck without side effects
-- ============================================================================

BEGIN;

-- ─── Step 0. 기존 중복 active share 정리 ──────────────────────────────────
-- (UNIQUE INDEX 생성 전 필수 — 기존 데이터에 중복이 있으면 인덱스 생성 실패)
-- 같은 (recipient_id, deck_id, share_mode) 가 active 로 N개면 가장 최근 1개만 남김
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY recipient_id, deck_id, share_mode
      ORDER BY accepted_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM deck_shares
  WHERE status = 'active'
    AND recipient_id IS NOT NULL
)
UPDATE deck_shares
SET status = 'revoked'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);


-- ─── Step 1. partial UNIQUE INDEX — 멱등성 보장 ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ds_recipient_deck_active
  ON deck_shares (recipient_id, deck_id, share_mode)
  WHERE status = 'active' AND recipient_id IS NOT NULL;


-- ─── Step 2. acquire_listing RPC — single atomic transaction ──────────────
-- PostgreSQL function 은 자동으로 single transaction 내에서 실행.
-- 어떤 단계에서든 RAISE EXCEPTION 발생 시 전체 rollback.
--
-- Returns: (deck_id UUID, was_new BOOLEAN)
--   was_new=true  → 신규 acquire (count++ 수행, cache invalidate 필요)
--   was_new=false → 이미 보유 (멱등 응답, side effect 없음)
--
-- Error codes:
--   P0001 — own listing acquire 시도 (business rule violation)
--   P0002 — listing not found / inactive
-- ============================================================================
CREATE OR REPLACE FUNCTION acquire_listing(
  p_listing_id UUID
)
-- OUT column names use 'acquired_' prefix to avoid PL/pgSQL identifier
-- collision with marketplace_listings.deck_id and deck_shares.deck_id.
RETURNS TABLE (acquired_deck_id UUID, is_new_acquisition BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_listing      RECORD;
  v_target_deck  UUID;
  v_existing     UUID;
  v_new_deck_id  UUID;
  v_is_readonly  BOOLEAN;
BEGIN
  -- ── 인증 ─────────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'P0001', HINT = 'auth_required';
  END IF;

  -- ── 1. listing 조회 + 검증 ───────────────────────────────────────────
  SELECT id, deck_id, owner_id, share_mode, is_active
    INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id;

  IF NOT FOUND OR NOT v_listing.is_active THEN
    RAISE EXCEPTION 'Listing not found or inactive: %', p_listing_id
      USING ERRCODE = 'P0002', HINT = 'listing_not_found';
  END IF;

  IF v_listing.owner_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot acquire own listing'
      USING ERRCODE = 'P0001', HINT = 'cannot_acquire_own';
  END IF;

  -- ── 2. 멱등성 체크: 이미 active share 있는지 확인 ───────────────────
  -- subscribe 모드는 deck_id = listing.deck_id
  -- copy/snapshot 모드는 과거에 복사한 deck_id (copied_deck_id) 가 있음
  SELECT
    CASE
      WHEN v_listing.share_mode = 'subscribe' THEN ds.deck_id
      ELSE COALESCE(ds.copied_deck_id, ds.deck_id)
    END
    INTO v_existing
  FROM deck_shares ds
  WHERE ds.recipient_id = v_user_id
    AND ds.deck_id = v_listing.deck_id
    AND ds.share_mode = v_listing.share_mode
    AND ds.status = 'active'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- 이미 보유 — side effect 없이 기존 deck_id 반환 (멱등)
    acquired_deck_id := v_existing;
    is_new_acquisition := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── 3. share_mode 별 처리 ────────────────────────────────────────────
  IF v_listing.share_mode = 'subscribe' THEN
    v_target_deck := v_listing.deck_id;

    -- deck_shares INSERT (UNIQUE 제약으로 중복 방지)
    INSERT INTO deck_shares (
      deck_id, owner_id, recipient_id, share_mode, status, accepted_at
    ) VALUES (
      v_target_deck, v_listing.owner_id, v_user_id,
      'subscribe', 'active', NOW()
    )
    ON CONFLICT (recipient_id, deck_id, share_mode)
      WHERE status = 'active' AND recipient_id IS NOT NULL
      DO NOTHING;

    -- progress 초기화 (이미 있으면 ON CONFLICT 로 skip)
    INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
    SELECT v_user_id, c.id, c.deck_id, 'new'
    FROM cards c
    WHERE c.deck_id = v_target_deck
    ON CONFLICT (user_id, card_id) DO NOTHING;

  ELSE
    -- copy / snapshot
    v_is_readonly := (v_listing.share_mode = 'snapshot');

    -- 기존 RPC 재사용 (같은 트랜잭션 내 호출이므로 atomic)
    v_new_deck_id := copy_deck_for_user(
      p_source_deck_id := v_listing.deck_id,
      p_recipient_id   := v_user_id,
      p_is_readonly    := v_is_readonly,
      p_share_mode     := v_listing.share_mode
    );

    v_target_deck := v_new_deck_id;

    -- share 기록 (tracking + 중복 가드)
    INSERT INTO deck_shares (
      deck_id, owner_id, recipient_id, share_mode, status,
      accepted_at, copied_deck_id
    ) VALUES (
      v_listing.deck_id, v_listing.owner_id, v_user_id,
      v_listing.share_mode, 'active', NOW(), v_new_deck_id
    )
    ON CONFLICT (recipient_id, deck_id, share_mode)
      WHERE status = 'active' AND recipient_id IS NOT NULL
      DO NOTHING;
  END IF;

  -- ── 4. acquire_count ++ (신규 acquire 시에만) ───────────────────────
  UPDATE marketplace_listings
  SET acquire_count = acquire_count + 1, updated_at = NOW()
  WHERE id = p_listing_id;

  -- ── 5. 정상 반환 ────────────────────────────────────────────────────
  acquired_deck_id := v_target_deck;
  is_new_acquisition := TRUE;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION acquire_listing(UUID) TO authenticated;

COMMENT ON FUNCTION acquire_listing(UUID) IS
  'Atomic + idempotent marketplace deck acquisition. '
  'Returns (acquired_deck_id, is_new_acquisition). '
  'is_new_acquisition=false means user already had it. '
  'Errors: P0001=auth/own_listing, P0002=not_found.';

COMMIT;
