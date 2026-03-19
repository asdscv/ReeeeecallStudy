-- ============================================================
-- 054_marketplace_discovery.sql
-- Enhanced marketplace discovery: denormalized owner info,
-- trending support index, and listing fetch RPC with owner data.
-- ============================================================

-- ─── 1. Add denormalized owner columns to marketplace_listings ──

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS owner_display_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_is_official BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. Backfill existing listings from profiles ──────────────

UPDATE marketplace_listings ml
SET
  owner_display_name = p.display_name,
  owner_is_official = p.is_official
FROM profiles p
WHERE p.id = ml.owner_id;

-- ─── 3. Trigger: auto-sync owner info on listing INSERT ────────

CREATE OR REPLACE FUNCTION sync_listing_owner_info()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT display_name, is_official
  INTO NEW.owner_display_name, NEW.owner_is_official
  FROM profiles
  WHERE id = NEW.owner_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_listing_owner_info ON marketplace_listings;
CREATE TRIGGER trg_sync_listing_owner_info
  BEFORE INSERT ON marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION sync_listing_owner_info();

-- ─── 4. Trigger: update listings when profile changes ──────────

CREATE OR REPLACE FUNCTION sync_listings_on_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.display_name IS DISTINCT FROM NEW.display_name
     OR OLD.is_official IS DISTINCT FROM NEW.is_official THEN
    UPDATE marketplace_listings
    SET
      owner_display_name = NEW.display_name,
      owner_is_official = NEW.is_official,
      updated_at = NOW()
    WHERE owner_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_listings_on_profile_update ON profiles;
CREATE TRIGGER trg_sync_listings_on_profile_update
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_listings_on_profile_update();

-- ─── 5. Index for trending sort (acquire_count + created_at) ───

CREATE INDEX IF NOT EXISTS idx_ml_trending
  ON marketplace_listings (acquire_count DESC, created_at DESC)
  WHERE is_active = true;

-- ─── 6. Index for verified publisher filter ────────────────────

CREATE INDEX IF NOT EXISTS idx_ml_owner_official
  ON marketplace_listings (owner_is_official)
  WHERE is_active = true AND owner_is_official = true;
