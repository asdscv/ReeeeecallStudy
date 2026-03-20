-- 063_performance_indexes.sql
-- Performance indexes for time-series queries and missing composite indexes.
-- All indexes use IF NOT EXISTS for idempotency.

------------------------------------------------------------------------
-- 1. user_card_progress: composite index on (user_id, deck_id, srs_status)
--    Speeds up per-deck SRS status breakdowns (e.g. "how many cards are
--    'new' vs 'learning' vs 'review' for this user in this deck?").
--    Existing indexes cover (user_id, deck_id) and (deck_id, srs_status)
--    separately but not the three-column composite.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ucp_user_deck_status
  ON user_card_progress (user_id, deck_id, srs_status);

------------------------------------------------------------------------
-- 2. marketplace_listings: (owner_id, created_at DESC)
--    Publisher dashboard queries filter by owner then sort by creation
--    date. The existing idx_ml_owner covers owner_id alone but cannot
--    satisfy the ORDER BY created_at DESC without an extra sort step.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ml_owner_created
  ON marketplace_listings (owner_id, created_at DESC);

------------------------------------------------------------------------
-- 3. content_views: (content_id, created_at)
--    Analytics time-range queries per content piece. The existing
--    idx_content_views_content_date covers (content_id, created_at DESC)
--    which handles DESC ordering; this ASC variant is useful for
--    range scans with BETWEEN / >= on created_at for a given content_id.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_content_views_content_created_asc
  ON content_views (content_id, created_at);

------------------------------------------------------------------------
-- 4. page_views: (page_path, created_at)
--    Analytics queries that aggregate views per page within a date range.
--    Existing idx_page_views_path_date is (page_path, created_at DESC);
--    this ASC companion helps range scans like
--    WHERE page_path = $1 AND created_at BETWEEN $2 AND $3.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_page_views_path_created_asc
  ON page_views (page_path, created_at);

------------------------------------------------------------------------
-- 5. study_sessions: partial index on completed sessions
--    Many queries (streaks, history, stats) filter on
--    completed_at IS NOT NULL. A partial index avoids scanning
--    abandoned/in-progress sessions.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_study_sessions_completed
  ON study_sessions (user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

------------------------------------------------------------------------
-- 6. CHECK constraint: profiles.daily_new_limit must be positive.
--    Wrapped in a DO block so re-running is safe (idempotent).
------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname  = 'chk_daily_new_limit_positive'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_daily_new_limit_positive
      CHECK (daily_new_limit > 0);
  END IF;
END
$$;
