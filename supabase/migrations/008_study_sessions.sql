-- ============================================================
-- Study Sessions: session-level history for study tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS study_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id          UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  study_mode       TEXT NOT NULL,
  cards_studied    INTEGER NOT NULL DEFAULT 0,
  total_cards      INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  ratings          JSONB NOT NULL DEFAULT '{}',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_completed
  ON study_sessions (user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_study_sessions_deck
  ON study_sessions (deck_id);

-- RLS
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sessions" ON study_sessions;
CREATE POLICY "Users manage own sessions"
  ON study_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
