-- ═══════════════════════════════════════════════════════
-- Migration 096: app version requirement (force / optional update gate)
-- ═══════════════════════════════════════════════════════
-- Adds a per-platform minimum supported app version so the mobile client can
-- hard-block builds that are too old (and softly nudge builds below latest).
--
-- The mobile app calls get_app_version_requirement(p_platform) on launch
-- (anon-callable, before login) and compares the installed binary version:
--   installed <  min_supported_version  -> blocked  (non-dismissable screen)
--   installed <  latest_version         -> optional (dismissable nudge)
--   otherwise                           -> ok
--
-- The client is FAIL-OPEN: if this RPC errors / times out / is absent, the gate
-- resolves to 'ok'. Seeding min_supported_version = '0.0.0' therefore makes the
-- feature dormant until an admin raises the floor for a real release, e.g.:
--   UPDATE app_version_requirements
--     SET min_supported_version = '1.1.0', latest_version = '1.2.0', updated_at = NOW()
--     WHERE platform = 'ios';
-- Never set the floor above a version users can actually install from the store,
-- or they will be bricked (blocked with no newer build to update to).
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_version_requirements (
  platform               TEXT PRIMARY KEY CHECK (platform IN ('ios', 'android')),
  min_supported_version  TEXT NOT NULL DEFAULT '0.0.0',
  latest_version         TEXT,
  store_url              TEXT,
  message                TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permissive defaults: a 0.0.0 floor blocks nobody until an admin sets a real
-- minimum. latest_version is seeded to the current store version (app.json).
INSERT INTO app_version_requirements (platform, min_supported_version, latest_version)
VALUES ('ios', '0.0.0', '1.0.2'),
       ('android', '0.0.0', '1.0.2')
ON CONFLICT (platform) DO NOTHING;

-- No direct table access — reads go exclusively through the SECURITY DEFINER
-- RPC below. RLS enabled with no policy = the table is private to the definer.
ALTER TABLE app_version_requirements ENABLE ROW LEVEL SECURITY;

-- ── Read RPC: returns the single row for a platform (or zero rows). ──
-- Anon-callable so the gate works before the user logs in.
CREATE OR REPLACE FUNCTION get_app_version_requirement(p_platform TEXT)
RETURNS TABLE (
  platform               TEXT,
  min_supported_version  TEXT,
  latest_version         TEXT,
  store_url              TEXT,
  message                TEXT,
  updated_at             TIMESTAMPTZ
) AS $$
  SELECT platform, min_supported_version, latest_version, store_url, message, updated_at
  FROM app_version_requirements
  WHERE platform = p_platform;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION get_app_version_requirement(TEXT) TO anon, authenticated;
