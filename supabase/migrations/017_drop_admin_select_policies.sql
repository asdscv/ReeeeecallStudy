-- ═══════════════════════════════════════════════════════
-- 017_drop_admin_select_policies.sql
--
-- Problem: Admin SELECT policies on all tables caused
-- admin users to see ALL users' decks/cards in their
-- normal app views (deck list, study, etc.).
--
-- Root cause: These policies were unnecessary because
-- admin dashboard functions all use SECURITY DEFINER,
-- which bypasses RLS entirely.
--
-- Fix: Drop admin SELECT policies from all tables
-- EXCEPT profiles (needed for admin user list query).
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins can read all card_templates" ON card_templates;
DROP POLICY IF EXISTS "Admins can read all decks"           ON decks;
DROP POLICY IF EXISTS "Admins can read all cards"           ON cards;
DROP POLICY IF EXISTS "Admins can read all deck_study_state" ON deck_study_state;
DROP POLICY IF EXISTS "Admins can read all study_logs"      ON study_logs;
DROP POLICY IF EXISTS "Admins can read all study_sessions"  ON study_sessions;
DROP POLICY IF EXISTS "Admins can read all deck_shares"     ON deck_shares;
DROP POLICY IF EXISTS "Admins can read all marketplace_listings" ON marketplace_listings;
DROP POLICY IF EXISTS "Admins can read all contents"        ON contents;
DROP POLICY IF EXISTS "Admins can read all api_keys"        ON api_keys;
DROP POLICY IF EXISTS "Admins can read all user_card_progress" ON user_card_progress;

-- NOTE: Keeping "Admins can read all profiles" — needed
-- for the admin user list (direct table query in fetchUsers).
