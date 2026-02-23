-- 039: Official Account System
-- Adds is_official column to profiles, with admin-only RPC and trigger protection.

-- 1. Add is_official column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

-- 2. Trigger: prevent non-admin from changing is_official via direct UPDATE
CREATE OR REPLACE FUNCTION prevent_official_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only block if is_official is actually changing
  IF OLD.is_official IS DISTINCT FROM NEW.is_official THEN
    -- Allow if the current user is an admin
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Only admins can change official status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_official_escalation ON profiles;
CREATE TRIGGER trg_prevent_official_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_official_escalation();

-- 3. Admin RPC: set official status
CREATE OR REPLACE FUNCTION admin_set_official_status(
  p_user_id UUID,
  p_is_official BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE profiles
  SET is_official = p_is_official,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT json_build_object(
    'user_id', p_user_id,
    'is_official', p_is_official
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 4. Partial index for filtering official accounts
CREATE INDEX IF NOT EXISTS idx_profiles_is_official
  ON profiles (is_official) WHERE is_official = true;
