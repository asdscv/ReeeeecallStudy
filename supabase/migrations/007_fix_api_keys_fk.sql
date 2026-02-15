-- ============================================================
-- Fix api_keys foreign key: profiles(id) -> auth.users(id)
-- Fix resolve_api_key volatility: STABLE -> VOLATILE
-- Add updated_at column + trigger
-- ============================================================

-- 1. Drop the broken FK and re-add with auth.users
DO $$
BEGIN
  -- Drop existing FK if it exists (name may vary)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'api_keys'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'api_keys_user_id_fkey'
  ) THEN
    ALTER TABLE api_keys DROP CONSTRAINT api_keys_user_id_fkey;
  END IF;
END $$;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Add updated_at if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE api_keys
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- 3. updated_at auto-refresh trigger
DROP TRIGGER IF EXISTS set_updated_at ON api_keys;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Re-create resolve_api_key with correct VOLATILE
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
