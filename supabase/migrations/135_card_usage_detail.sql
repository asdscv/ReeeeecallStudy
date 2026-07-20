-- ============================================================================
-- 135: get_card_usage_detail() — the breakdown a detailed usage panel needs.
--
-- get_owned_card_usage() (mig 119) returns only {owned, card_limit, available} — a
-- single merged integer. A "big-tech" usage display wants the split behind that
-- number, so this RPC returns, for auth.uid():
--   owned_own        — cards in decks the user OWNS (decks.user_id = uid), non-official
--   owned_subscribed — cards in decks the user actively SUBSCRIBES to, non-official
--   used_total       — owned_own + owned_subscribed  (== get_owned_card_usage.owned)
--   official_excluded— cards in official-certified decks (owned or subscribed) that are
--                      EXCLUDED from the cap (informational; 0 when count_official_cards)
--   card_limit       — effective cap (_owned_card_limit(uid); 2e9 == unlimited sentinel)
--   available        — greatest(card_limit - used_total, 0)
--   is_unlimited     — card_limit >= 1e9
--   archived_total   — owned non-official cards ARCHIVED from study (created_at past the
--                      account-wide boundary; account-wide roll-up of the per-deck
--                      get_deck_archived_count). 0 when not over the cap.
--
-- Counting mirrors _owned_card_count (mig 118) + get_active_card_threshold (mig 126)
-- EXACTLY, so the panel, the guard (check_card_limit + trigger, mig 134), and the
-- archive boundary all agree. Official exclusion honors card_limit_settings.
--
-- auth.uid()-scoped (NO caller-id param → no IDOR). SECURITY DEFINER + REVOKE anon.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_card_usage_detail()
  RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false
    ) AS inc_official
  ),
  thr AS (
    SELECT public.get_active_card_threshold() AS ts
  ),
  -- Effective cap. _owned_card_limit is admin-aware (mig 137 → 2e9 for admins), so this
  -- single source keeps the meter, the archive boundary, the cap and the trigger in
  -- agreement (admins read unlimited; nothing archived).
  eff AS (
    SELECT public._owned_card_limit(auth.uid()) AS lim
  ),
  -- Every card in a deck the user OWNS or actively SUBSCRIBES to, tagged owned/official.
  scoped AS (
    SELECT
      (d.user_id = auth.uid()) AS is_owned,
      EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id) AS is_official,
      c.created_at
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.user_id = auth.uid()
       OR EXISTS (
         SELECT 1 FROM deck_shares ds
         WHERE ds.deck_id = d.id
           AND ds.recipient_id = auth.uid()
           AND ds.share_mode = 'subscribe'
           AND ds.status = 'active'
       )
  ),
  agg AS (
    SELECT
      count(*) FILTER (
        WHERE is_owned AND ((SELECT inc_official FROM cfg) OR NOT is_official)
      )::int AS owned_own,
      count(*) FILTER (
        WHERE NOT is_owned AND ((SELECT inc_official FROM cfg) OR NOT is_official)
      )::int AS owned_subscribed,
      count(*) FILTER (
        WHERE is_official AND NOT (SELECT inc_official FROM cfg)
      )::int AS official_excluded,
      count(*) FILTER (
        WHERE is_owned AND NOT is_official
          AND (SELECT ts FROM thr) IS NOT NULL
          AND created_at > (SELECT ts FROM thr)
      )::int AS archived_total
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
    'archived_total',    a.archived_total
  )
  FROM agg a CROSS JOIN eff e;
$$;
REVOKE EXECUTE ON FUNCTION public.get_card_usage_detail() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_card_usage_detail() TO authenticated;
