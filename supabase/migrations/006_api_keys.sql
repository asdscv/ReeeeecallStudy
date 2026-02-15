-- ============================================================
-- API Keys table for external REST API authentication
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,            -- SHA-256 hex of the plain key
  name         TEXT NOT NULL DEFAULT '',        -- user-given label
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,                    -- null = no expiration
  last_used_at TIMESTAMPTZ,

  CONSTRAINT one_key_per_user UNIQUE (user_id)
);

-- Index for fast lookup by hash (the hot path on every API call)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON api_keys (key_hash) WHERE is_active = true;

-- RLS: users can only manage their own keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own keys" ON api_keys;
CREATE POLICY "Users manage own keys"
  ON api_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at auto-refresh
DROP TRIGGER IF EXISTS set_updated_at ON api_keys;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Helper: look up user_id from a key hash (used by Edge Function)
-- Returns NULL if key is invalid, inactive, or expired.
-- NOTE: VOLATILE because it performs an UPDATE (last_used_at).
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_api_key(p_key_hash TEXT)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  UPDATE api_keys
  SET last_used_at = NOW()
  WHERE key_hash = p_key_hash
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > NOW())
  RETURNING user_id;
$$;
