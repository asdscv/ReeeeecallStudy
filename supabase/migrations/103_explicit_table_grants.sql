-- ============================================================================
-- 103: Make anon/authenticated table grants EXPLICIT (CI determinism + future-proof).
--
-- Supabase's local stack images (CLI/images >= ~2.107.0) stopped auto-granting
-- DML (SELECT/INSERT/UPDATE/DELETE) to anon/authenticated on `db reset`. On a
-- fresh DB the roles end up with only REFERENCES/TRIGGER/TRUNCATE, so RLS-gated
-- access turns into "permission denied for table …" — e.g. the marketplace
-- acquire integration test (acquire_listing → deck_shares) went red even though
-- prod and the migrations are healthy (verified: prod + CLI 2.95.4 grant DML).
--
-- Make the grants explicit so ANY fresh DB (CI, disaster recovery, new env)
-- matches production. RLS still governs actual row access — these are table-level
-- grants only, identical to what prod already has (idempotent there). Function
-- EXECUTE is deliberately NOT touched here, so the security REVOKEs in mig 097/098
-- (resolve_api_key, _seed_default_templates, increment_acquire_count, …) stay in
-- effect.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
