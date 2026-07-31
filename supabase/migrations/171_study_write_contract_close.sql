-- ============================================================================
-- 171: Study write contract — CONTRACT phase (was part of migration 161).
--
-- Migration 161 (expand) added the RPCs the client needs; the cutover build then
-- has to be LIVE before these grants disappear, because a pre-cutover client
-- writes study_logs / study_sessions / user_card_progress directly and calls
-- `insert_study_log`. Applying this before that deploy breaks the running app.
--
-- Table-wide UPDATE is NOT removed — card editing and batch-size tuning stay
-- client-side — so the revokes are COLUMN-LEVEL and re-grant exactly the columns
-- clients still own.
--
-- ORDER: 161 → deploy the cutover client → 171.
-- ============================================================================
-- ── 3) Drop the superseded log RPC ─────────────────────────────────────────
-- apply_study_rating writes study_logs inside the rating transaction and links the
-- row to its rating event; a standalone log insert can only create orphans.
DROP FUNCTION IF EXISTS public.insert_study_log(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text);

-- ── 5) Close the direct write paths ────────────────────────────────────────
-- cards: keep content editing, remove SRS + revision writes.
REVOKE UPDATE ON TABLE public.cards FROM anon, authenticated;
GRANT UPDATE (field_values, tags, sort_position, template_id, updated_at)
  ON TABLE public.cards TO authenticated;

-- user_card_progress: every column is SRS state → no client UPDATE at all.
-- INSERT stays: init_subscriber_progress / acquire seeding run as the caller in
-- some paths, and a bare insert cannot forge SRS state (defaults + RLS own-row).
REVOKE UPDATE ON TABLE public.user_card_progress FROM anon, authenticated;

-- study_logs / study_sessions: history is server-written only. SELECT stays so
-- analytics pages keep working.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.study_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.study_sessions FROM anon, authenticated;

-- deck_study_state: cursors belong to finalize_study_session; batch sizes stay
-- client-tunable. INSERT stays for session bootstrap.
REVOKE UPDATE ON TABLE public.deck_study_state FROM anon, authenticated;
GRANT UPDATE (new_batch_size, review_batch_size, updated_at)
  ON TABLE public.deck_study_state TO authenticated;

-- Server/edge paths keep full access.
GRANT ALL ON TABLE public.cards, public.user_card_progress, public.study_logs,
  public.study_sessions, public.deck_study_state TO service_role;
