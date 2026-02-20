-- 032: Nickname uniqueness constraint + availability check RPC
-- Following migration 022 pattern: clean duplicates before adding UNIQUE index

BEGIN;

-- ─── Step 1: Remove duplicate display_names (keep earliest profile) ─────
DELETE FROM profiles
WHERE id NOT IN (
  SELECT DISTINCT ON (LOWER(display_name)) id
  FROM profiles
  WHERE display_name IS NOT NULL
  ORDER BY LOWER(display_name), created_at ASC
)
AND display_name IS NOT NULL
AND EXISTS (
  SELECT 1 FROM profiles p2
  WHERE LOWER(p2.display_name) = LOWER(profiles.display_name)
  AND p2.id != profiles.id
);

-- ─── Step 2: Case-insensitive unique index on display_name ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_display_name_unique
  ON profiles (LOWER(display_name))
  WHERE display_name IS NOT NULL;

-- ─── Step 3: RPC function to check nickname availability ────────────────
CREATE OR REPLACE FUNCTION check_nickname_available(p_nickname TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trimmed TEXT;
BEGIN
  v_trimmed := TRIM(p_nickname);

  -- Validate input
  IF v_trimmed IS NULL OR LENGTH(v_trimmed) < 2 OR LENGTH(v_trimmed) > 12 THEN
    RETURN json_build_object('available', false, 'error', 'invalid_length');
  END IF;

  -- Case-insensitive check
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE LOWER(display_name) = LOWER(v_trimmed)
  ) THEN
    RETURN json_build_object('available', false);
  ELSE
    RETURN json_build_object('available', true);
  END IF;
END;
$$;

-- Grant to both anon (signup form) and authenticated users
GRANT EXECUTE ON FUNCTION check_nickname_available(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_nickname_available(TEXT) TO authenticated;

COMMIT;
