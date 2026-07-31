-- ============================================================================
-- 142: FIX — official subscribed decks must NEVER be study-locked (mig 140 bug).
--
-- mig 140's get_subscribed_active_threshold / is_subscribed_deck_active decide the
-- over-cap subscription study-lock purely by deck_shares.accepted_at, WITHOUT
-- excluding official (official_deck_manifest) decks. Official subscriptions are free
-- and uncapped (acquire_listing/_owned_card_count exclude them), but they still
-- occupied an accepted_at slot in the ranking, so an over-cap user's official
-- subscribed decks could fall past the cutoff → is_subscribed_deck_active=false →
-- study-store locks them (silent 0-card lock: archived_total/badge exclude official,
-- so the meter shows nothing while study is blocked). This broke the "official never
-- counts / never locks" invariant. Fix: exclude official decks from the ranking AND
-- short-circuit is_subscribed_deck_active=true for official decks. Honors
-- count_official_cards. Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_subscribed_active_threshold()
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false) AS inc_official
  ),
  lim AS (SELECT public._owned_card_limit(auth.uid()) AS n),
  owned AS (
    SELECT count(*)::int AS c
    FROM cards c JOIN decks d ON d.id = c.deck_id
    WHERE d.user_id = auth.uid()
      AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
  ),
  rem AS (SELECT GREATEST((SELECT n FROM lim) - (SELECT c FROM owned), 0) AS r),
  subs AS (
    SELECT ds.deck_id, ds.accepted_at,
      (SELECT count(*) FROM cards c JOIN decks d ON d.id = c.deck_id
        WHERE d.id = ds.deck_id
          AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
      ) AS cnt
    FROM deck_shares ds
    WHERE ds.recipient_id = auth.uid()
      AND ds.share_mode = 'subscribe'
      AND ds.status = 'active'
      -- ★ mig 142: OFFICIAL subscribed decks are free/uncapped → never enter the ranking,
      -- so they never consume a slot and never get locked.
      AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = ds.deck_id))
  ),
  ranked AS (
    SELECT deck_id, accepted_at, cnt,
      sum(cnt) OVER (ORDER BY accepted_at ASC, deck_id ASC) AS running
    FROM subs
  )
  SELECT CASE
    WHEN (SELECT n FROM lim) >= 1000000000 THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM ranked WHERE running > (SELECT r FROM rem)) THEN NULL
    ELSE COALESCE(
      (SELECT max(accepted_at) FROM ranked WHERE running <= (SELECT r FROM rem)),
      '-infinity'::timestamptz)
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_subscribed_active_threshold() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_subscribed_active_threshold() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_subscribed_deck_active(p_deck_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    -- ★ mig 142: OFFICIAL decks are never study-locked (excluded from the cap), unless
    -- count_official_cards is on. Short-circuit BEFORE the accepted_at cutoff compare.
    WHEN EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = p_deck_id)
         AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false)
      THEN true
    ELSE COALESCE(
      (SELECT ds.accepted_at <= COALESCE(public.get_subscribed_active_threshold(), 'infinity'::timestamptz)
       FROM deck_shares ds
       WHERE ds.recipient_id = auth.uid()
         AND ds.deck_id = p_deck_id
         AND ds.share_mode = 'subscribe'
         AND ds.status = 'active'
       LIMIT 1),
      true)
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) TO authenticated;
