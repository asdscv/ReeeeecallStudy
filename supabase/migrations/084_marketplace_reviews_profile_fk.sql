-- ============================================================================
-- Migration 084 — marketplace_reviews: explicit FK to profiles
--
-- Root cause:
--   marketplace_reviews.user_id REFERENCES auth.users(id), not profiles(id).
--   The web app does:
--     supabase.from('marketplace_reviews').select('*, profiles:user_id(display_name)')
--   which is a PostgREST embed asking it to follow user_id → profiles. PostgREST
--   cannot detect this relationship because:
--     1. The only FK on user_id targets auth.users
--     2. Cross-schema (public ↔ auth) embeds are disabled
--
--   Result: "Could not find a relationship between 'marketplace_reviews' and
--   'user_id' in the schema cache" — Ratings & Reviews section breaks.
--
-- Fix:
--   Add a SECOND FK constraint on marketplace_reviews.user_id pointing to
--   profiles(id). PostgreSQL allows multiple FKs on the same column; both are
--   enforced. Since profiles.id is itself an FK to auth.users.id, every valid
--   user_id satisfies both constraints. PostgREST will then resolve the embed
--   `profiles:user_id(...)` via the new FK.
--
--   Same fix for review_helpfuls (preventive — same shape).
-- ============================================================================

BEGIN;

ALTER TABLE marketplace_reviews
  DROP CONSTRAINT IF EXISTS marketplace_reviews_user_id_profile_fk;

ALTER TABLE marketplace_reviews
  ADD CONSTRAINT marketplace_reviews_user_id_profile_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE review_helpfuls
  DROP CONSTRAINT IF EXISTS review_helpfuls_user_id_profile_fk;

ALTER TABLE review_helpfuls
  ADD CONSTRAINT review_helpfuls_user_id_profile_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- Tell PostgREST to reload its schema cache so the new FK is discoverable
-- immediately without waiting for the next periodic reload.
NOTIFY pgrst, 'reload schema';

COMMIT;
