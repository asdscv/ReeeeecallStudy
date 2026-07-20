-- ============================================================================
-- 140: Over-cap SUBSCRIBED non-official cards are study-locked too (pay to use).
--
-- Owner intent: the card cap is a monetization gate. mig 118 made non-official
-- SUBSCRIBED cards COUNT toward the cap, but nothing ever locked them from study —
-- so an over-cap subscriber kept studying everything free (audit L1). This mirrors
-- the owned-card archive (mig 123/126) onto subscriptions.
--
-- MODEL — "your own cards keep priority":
--   * OWNED non-official cards fill the cap first (unchanged: get_active_card_threshold,
--     per-card created_at boundary; only locked when OWNED alone exceeds N).
--   * remaining = max(N - owned_non_official_count, 0) slots go to SUBSCRIPTIONS,
--     oldest subscription (deck_shares.accepted_at) first, WHOLE deck at a time.
--   * The newest subscribed decks that overflow `remaining` are STUDY-LOCKED — cards
--     stay viewable, just not studyable — and restored automatically when the cap
--     rises (re-subscribe / plan upgrade). Never deleted.
--
-- Boundary = a single accepted_at cutoff: a subscribed non-official deck is ACTIVE iff
-- its share.accepted_at <= cutoff. NULL cutoff = nothing locked (the common case).
-- '-infinity' = everything locked (owned already fills the cap). Unlimited (>=1e9) and
-- under-cap both return NULL. auth.uid()-scoped, SECURITY DEFINER, REVOKE anon.
-- ============================================================================

-- ── the accepted_at cutoff for the caller's active subscribe decks ───────────
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
  ),
  ranked AS (
    SELECT deck_id, accepted_at, cnt,
      sum(cnt) OVER (ORDER BY accepted_at ASC, deck_id ASC) AS running
    FROM subs
  )
  SELECT CASE
    WHEN (SELECT n FROM lim) >= 1000000000 THEN NULL                                  -- unlimited → none locked
    WHEN NOT EXISTS (SELECT 1 FROM ranked WHERE running > (SELECT r FROM rem)) THEN NULL  -- all fit → none locked
    ELSE COALESCE(
      (SELECT max(accepted_at) FROM ranked WHERE running <= (SELECT r FROM rem)),
      '-infinity'::timestamptz)                                                        -- remaining exhausted → all locked
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_subscribed_active_threshold() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_subscribed_active_threshold() TO authenticated;

-- ── per-deck: is this subscribed deck currently studyable for the caller? ─────
-- true for owned / official / non-subscribed decks (lock N/A) and for active subs;
-- false only for a caller's active subscribe deck that overflowed the cap.
CREATE OR REPLACE FUNCTION public.is_subscribed_deck_active(p_deck_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ds.accepted_at <= COALESCE(public.get_subscribed_active_threshold(), 'infinity'::timestamptz)
     FROM deck_shares ds
     WHERE ds.recipient_id = auth.uid()
       AND ds.deck_id = p_deck_id
       AND ds.share_mode = 'subscribe'
       AND ds.status = 'active'
     LIMIT 1),
    true);   -- not a subscribed deck for this caller → never locked here
$$;
REVOKE EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) TO authenticated;

-- ── get_card_usage_detail: archived_total now includes locked subscribed cards ──
CREATE OR REPLACE FUNCTION public.get_card_usage_detail()
  RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false) AS inc_official
  ),
  owned_thr AS (SELECT public.get_active_card_threshold() AS ts),
  sub_thr   AS (SELECT public.get_subscribed_active_threshold() AS ts),
  scoped AS (
    SELECT
      (d.user_id = auth.uid()) AS is_owned,
      EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id) AS is_official,
      c.created_at,
      -- the caller's active subscribe share's accepted_at for this deck (NULL if owned)
      (SELECT ds.accepted_at FROM deck_shares ds
        WHERE ds.recipient_id = auth.uid() AND ds.deck_id = d.id
          AND ds.share_mode = 'subscribe' AND ds.status = 'active' LIMIT 1) AS sub_accepted_at
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.user_id = auth.uid()
       OR EXISTS (SELECT 1 FROM deck_shares ds
                  WHERE ds.deck_id = d.id AND ds.recipient_id = auth.uid()
                    AND ds.share_mode = 'subscribe' AND ds.status = 'active')
  ),
  agg AS (
    SELECT
      count(*) FILTER (WHERE is_owned      AND ((SELECT inc_official FROM cfg) OR NOT is_official))::int AS owned_own,
      count(*) FILTER (WHERE NOT is_owned  AND ((SELECT inc_official FROM cfg) OR NOT is_official))::int AS owned_subscribed,
      count(*) FILTER (WHERE is_official   AND NOT (SELECT inc_official FROM cfg))::int                  AS official_excluded,
      -- owned excess past the owned boundary
      count(*) FILTER (
        WHERE is_owned AND NOT is_official
          AND (SELECT ts FROM owned_thr) IS NOT NULL
          AND created_at > (SELECT ts FROM owned_thr)
      )::int AS archived_owned,
      -- subscribed cards in locked decks (accepted_at past the subscribe boundary)
      count(*) FILTER (
        WHERE NOT is_owned AND NOT is_official
          AND (SELECT ts FROM sub_thr) IS NOT NULL
          AND sub_accepted_at > (SELECT ts FROM sub_thr)
      )::int AS archived_subscribed
    FROM scoped
  )
  SELECT json_build_object(
    'owned_own',         a.owned_own,
    'owned_subscribed',  a.owned_subscribed,
    'used_total',        a.owned_own + a.owned_subscribed,
    'official_excluded', a.official_excluded,
    'card_limit',        e.lim,
    'available',         greatest(e.lim - (a.owned_own + a.owned_subscribed), 0),
    'is_unlimited',      (e.lim >= 1000000000),
    'archived_total',    a.archived_owned + a.archived_subscribed
  )
  FROM agg a CROSS JOIN (SELECT public._owned_card_limit(auth.uid()) AS lim) e;
$$;
REVOKE EXECUTE ON FUNCTION public.get_card_usage_detail() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_card_usage_detail() TO authenticated;

-- ── get_deck_archived_count: owned excess OR (whole) locked subscribed deck ───
CREATE OR REPLACE FUNCTION public.get_deck_archived_count(p_deck_id uuid)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false) AS inc_official
  )
  SELECT COALESCE((
    -- OWNED deck: cards past the owned boundary
    SELECT count(*)::int
    FROM cards c JOIN decks d ON d.id = c.deck_id
    CROSS JOIN (SELECT public.get_active_card_threshold() AS ts) t
    WHERE c.deck_id = p_deck_id
      AND d.user_id = auth.uid()
      AND t.ts IS NOT NULL
      AND c.created_at > t.ts
      AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
  ), 0)
  +
  COALESCE((
    -- SUBSCRIBED deck that is LOCKED (whole deck): all its non-official cards
    SELECT count(*)::int
    FROM cards c JOIN decks d ON d.id = c.deck_id
    WHERE c.deck_id = p_deck_id
      AND NOT public.is_subscribed_deck_active(p_deck_id)
      AND EXISTS (SELECT 1 FROM deck_shares ds
                  WHERE ds.deck_id = d.id AND ds.recipient_id = auth.uid()
                    AND ds.share_mode = 'subscribe' AND ds.status = 'active')
      AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
  ), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_deck_archived_count(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_deck_archived_count(uuid) TO authenticated;
