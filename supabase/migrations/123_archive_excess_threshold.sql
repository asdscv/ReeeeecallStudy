-- ============================================================================
-- 123: Archive-the-excess via a BOUNDARY TIMESTAMP (scalable, never delete).
--
-- Policy: an account may keep up to N owned NON-OFFICIAL cards ACTIVE in study
-- (N = public._owned_card_limit(uid): the global card_limit_settings cap, raised
-- to the plan cap by a paid subscription — mig 116 + 121). When a user OWNS more
-- than N such cards, the EXCESS (created AFTER the N-th oldest) is ARCHIVED FROM
-- STUDY only — those cards stay fully viewable / editable / deletable, NEVER
-- hidden or deleted.
--
-- SCALABILITY: we do NOT materialize the archived id list (it can be huge).
-- Instead compute ONE boundary value:
--     active_threshold = created_at of the N-th oldest owned non-official card.
-- A card is ARCHIVED iff (owned, non-official, and) created_at > active_threshold.
-- Study range-filters to created_at <= active_threshold — an INDEXED RANGE — so
-- the payload is only the ACTIVE cards and the cost is O(index), independent of
-- library size.
--
--   * <= N such cards  → OFFSET returns no row → threshold NULL → nothing archived
--                        (all active). "NULL = NOT over limit".
--   * OFFICIAL-deck cards never count (count_official_cards toggle) and are always
--     active — the archive boundary applies only to owned non-official cards.
--   * created_at TIES on the boundary → those few extra cards stay ACTIVE (the
--     study filter is created_at <= threshold; archived is a STRICT >). Errs
--     toward MORE study access — safe.
--   * Fully dynamic: re-subscribe raises N → threshold recomputes to a later card
--     or NULL → study is restored automatically, no backfill.
--
-- Mirrors _owned_card_count (mig 116) exactly for what "counts": owned =
-- decks.user_id = uid, official excluded via card_limit_settings.count_official_cards
-- + official_deck_manifest. So the boundary and the cap agree by construction.
--
-- Additive/idempotent: CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── 1) Index for the boundary skip + the study range-filter ──────────────────
-- Supports the JOIN decks + ORDER BY c.created_at ASC, c.id ASC OFFSET N-1 skip
-- and the study-side created_at <= threshold range scan. mig 001 already has a
-- PREFIX idx_cards_created (deck_id, created_at) but it lacks the trailing `id`
-- tie-break column (so it can't drive the ORDER BY ... , id ASC as an index-only
-- skip), hence this fuller 3-column index. IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS idx_cards_deck_created ON public.cards (deck_id, created_at, id);

-- ── 2) get_active_card_threshold() — the boundary created_at for auth.uid() ──
-- The created_at of the N-th oldest owned non-official card (N = _owned_card_limit).
-- OFFSET (N-1) LIMIT 1 lands on the N-th row; if the user owns <= N such cards the
-- OFFSET falls off the end → NO row → NULL (meaning NOT over limit → nothing
-- archived). auth.uid()-scoped (no IDOR param) → safe.
CREATE OR REPLACE FUNCTION public.get_active_card_threshold()
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.created_at
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE d.user_id = auth.uid()
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    )
  ORDER BY c.created_at ASC, c.id ASC
  OFFSET (public._owned_card_limit(auth.uid()) - 1)
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_card_threshold() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_card_threshold() TO authenticated;

-- ── 3) get_deck_archived_count(p_deck_id) — archived cards IN ONE owned deck ──
-- 0 when the caller doesn't own the deck OR the threshold is NULL (not over limit);
-- else the count of THIS deck's owned non-official cards with created_at > threshold
-- (STRICT > → boundary ties stay active). Threshold computed ONCE via the CTE
-- (reuses get_active_card_threshold → single source of truth). auth.uid()-scoped.
CREATE OR REPLACE FUNCTION public.get_deck_archived_count(p_deck_id uuid)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH threshold AS (
    SELECT public.get_active_card_threshold() AS ts
  )
  SELECT COALESCE((
    SELECT count(*)::int
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    CROSS JOIN threshold t
    WHERE c.deck_id = p_deck_id
      AND d.user_id = auth.uid()
      AND t.ts IS NOT NULL
      AND c.created_at > t.ts
      AND (
        (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
        OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
      )
  ), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_deck_archived_count(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_deck_archived_count(uuid) TO authenticated;
