-- ============================================================================
-- 118: the owned-card limit counts SUBSCRIBED (non-official) decks too
--
-- Owner intent: the 1000-card cap should reflect the study cards you have — your
-- OWNED cards PLUS the cards in decks you SUBSCRIBE to — and exclude ONLY
-- official-certified decks. Previously subscriptions (publisher-owned) were never
-- counted, so a user could subscribe to unlimited non-official decks and bypass the
-- cap. Copy/snapshot acquisitions already counted (they become owned via
-- copy_deck_for_user, which is guarded). Now subscriptions count too, and
-- acquire_listing enforces the cap on the subscribe path.
--
-- Official decks (official_deck_manifest) stay excluded whether owned OR subscribed,
-- unless card_limit_settings.count_official_cards is on.
-- ============================================================================

-- ── 1) _owned_card_count: owned decks OR active 'subscribe' shares, official-excluded ──
CREATE OR REPLACE FUNCTION public._owned_card_count(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::int
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE (
      d.user_id = p_owner
      OR EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.deck_id = d.id
          AND ds.recipient_id = p_owner
          AND ds.share_mode = 'subscribe'
          AND ds.status = 'active'
      )
    )
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_count(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) acquire_listing: enforce the cap on the SUBSCRIBE path ──
-- (copy/snapshot already routes through copy_deck_for_user's guard). Identical to
-- mig 081 except the two marked lines in the subscribe branch.
CREATE OR REPLACE FUNCTION acquire_listing(
  p_listing_id UUID
)
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
  v_add_count    INTEGER;   -- mig 118: non-official cards a subscription would add
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'P0001', HINT = 'auth_required';
  END IF;

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
    acquired_deck_id := v_existing;
    is_new_acquisition := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_listing.share_mode = 'subscribe' THEN
    v_target_deck := v_listing.deck_id;

    -- ★ mig 118: owned-card limit — a non-official subscription counts toward the cap.
    SELECT count(*)::int INTO v_add_count
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.id = v_target_deck
      AND (
        (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
        OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
      );
    PERFORM check_card_limit(v_user_id, v_add_count);  -- raises PT402 if it would exceed

    INSERT INTO deck_shares (
      deck_id, owner_id, recipient_id, share_mode, status, accepted_at
    ) VALUES (
      v_target_deck, v_listing.owner_id, v_user_id,
      'subscribe', 'active', NOW()
    )
    ON CONFLICT (recipient_id, deck_id, share_mode)
      WHERE status = 'active' AND recipient_id IS NOT NULL
      DO NOTHING;

    INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
    SELECT v_user_id, c.id, c.deck_id, 'new'
    FROM cards c
    WHERE c.deck_id = v_target_deck
    ON CONFLICT (user_id, card_id) DO NOTHING;

  ELSE
    v_is_readonly := (v_listing.share_mode = 'snapshot');

    v_new_deck_id := copy_deck_for_user(
      p_source_deck_id := v_listing.deck_id,
      p_recipient_id   := v_user_id,
      p_is_readonly    := v_is_readonly,
      p_share_mode     := v_listing.share_mode
    );

    v_target_deck := v_new_deck_id;

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

  UPDATE marketplace_listings
  SET acquire_count = acquire_count + 1, updated_at = NOW()
  WHERE id = p_listing_id;

  acquired_deck_id := v_target_deck;
  is_new_acquisition := TRUE;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION acquire_listing(UUID) TO authenticated;
