-- ============================================================================
-- Rollback: 166_atomic_study_recording
-- Removes rate_card_and_log RPC, client_rating_id column/index.
-- Restores insert_study_log PUBLIC/anon grants to pre-161 state.
-- Does NOT touch any other existing table, column, or function.
-- For local/dev rollback. Run manually if needed.
-- ============================================================================

BEGIN;

-- ── Drop rate_card_and_log function ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rate_card_and_log(
  uuid, uuid, text, text, text, integer, real, integer,
  text, integer, real, integer, timestamptz, integer, uuid
);

-- ── Remove client_rating_id column and index ────────────────────────────────
DROP INDEX IF EXISTS idx_study_logs_client_rating_id;
ALTER TABLE study_logs DROP COLUMN IF EXISTS client_rating_id;
ALTER TABLE study_logs DROP COLUMN IF EXISTS client_rating_payload;

-- ── Keep insert_study_log hardened ─────────────────────────────────────────
-- Rolling back the atomic path must not re-open an anonymous/PUBLIC write path.
REVOKE EXECUTE ON FUNCTION public.insert_study_log(
  uuid, uuid, uuid, text, text, integer, integer, real, real, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_study_log(
  uuid, uuid, uuid, text, text, integer, integer, real, real, integer, text
) TO authenticated;

COMMIT;
