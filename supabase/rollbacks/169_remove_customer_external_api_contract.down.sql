-- Rollback 169 is intentionally a no-op.
-- Customer API credentials were already destroyed by migration 117 and cannot be
-- safely reconstructed. Reintroduction requires a new reviewed expand migration,
-- a new endpoint, and newly issued credentials; never resurrect stale key material.
BEGIN;
DO $$ BEGIN
  RAISE NOTICE 'Customer external API contract remains removed; no unsafe rollback performed.';
END $$;
COMMIT;
