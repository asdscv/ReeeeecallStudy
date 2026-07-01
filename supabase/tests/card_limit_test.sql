-- ============================================================================
-- card_limit_test.sql — Phase 1 owned-card ownership limit (mig 116).
-- Verifies: owned-card count (official excluded), the check_card_limit guard
-- (block at cap / boundary / no-op), the official-exclusion CONFIG TOGGLE, and
-- the admin bypass. Runs inside a txn and ROLLBACKs → leaves no data.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- Disable triggers for fixture setup (profiles.role is guarded by
-- prevent_role_escalation; we need to seed an admin). Whole txn ROLLBACKs.
SET session_replication_role = replica;

-- Actors: u1 (regular), adm (admin).
INSERT INTO auth.users (id) VALUES
  ('c1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, role) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'user'),
  ('c1000000-0000-0000-0000-000000000002', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Small cap for testing.
UPDATE card_limit_settings SET max_owned_cards = 3, count_official_cards = false WHERE id = 1;

-- u1: template + deck + 3 owned cards (= cap).
INSERT INTO card_templates (id, user_id, name)
  VALUES ('7e000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','T1');
INSERT INTO decks (id, user_id, name)
  VALUES ('4e000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','D1');
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '4e000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
       '7e000000-0000-0000-0000-000000000001', g
FROM generate_series(1,3) g;

-- 1. count = 3
DO $$ BEGIN
  ASSERT public._owned_card_count('c1000000-0000-0000-0000-000000000001'::uuid) = 3, 'owned count should be 3';
END $$;

-- 2. blocked at cap (3 + 1 > 3) with SQLSTATE PT402
DO $$ DECLARE r boolean := false; BEGIN
  BEGIN PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000001'::uuid, 1);
  EXCEPTION WHEN sqlstate 'PT402' THEN r := true; END;
  ASSERT r, 'check_card_limit should raise PT402 at the cap';
END $$;

-- 3. no-op for adding <= 0
DO $$ BEGIN
  PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000001'::uuid, 0);
  PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000001'::uuid, -5);
END $$;

-- 4. boundary: at 2 owned, +1 ok (=3), +2 blocked (>3)
DELETE FROM cards WHERE deck_id='4e000000-0000-0000-0000-000000000001' AND sort_position=3;
DO $$ BEGIN PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000001'::uuid, 1); END $$;  -- 2+1=3 ok
DO $$ DECLARE r boolean := false; BEGIN
  BEGIN PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000001'::uuid, 2);
  EXCEPTION WHEN sqlstate 'PT402' THEN r := true; END;
  ASSERT r, '2 + 2 > 3 should block';
END $$;
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
  VALUES ('4e000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000001',3);

-- 5. OFFICIAL exclusion: mark u1's deck official (manifest) → excluded → count 0
INSERT INTO official_deck_manifest (manifest_key, deck_id, source_file, source_language, target_language, category, last_status)
  VALUES ('cl-test-manifest','4e000000-0000-0000-0000-000000000001','f.csv','en','ko','test','applied');
DO $$ BEGIN
  ASSERT public._owned_card_count('c1000000-0000-0000-0000-000000000001'::uuid) = 0, 'official-manifest deck cards must be excluded';
END $$;

-- 6. CONFIG TOGGLE: count_official_cards = true → official cards now count (=3)
UPDATE card_limit_settings SET count_official_cards = true WHERE id = 1;
DO $$ BEGIN
  ASSERT public._owned_card_count('c1000000-0000-0000-0000-000000000001'::uuid) = 3, 'toggle ON → official cards counted';
END $$;
UPDATE card_limit_settings SET count_official_cards = false WHERE id = 1;
DELETE FROM official_deck_manifest WHERE manifest_key='cl-test-manifest';

-- 7. ADMIN bypass: admin over the cap still passes
INSERT INTO card_templates (id, user_id, name)
  VALUES ('7e000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','T2');
INSERT INTO decks (id, user_id, name)
  VALUES ('4e000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','AdmD');
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '4e000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002',
       '7e000000-0000-0000-0000-000000000002', g
FROM generate_series(1,5) g;
DO $$ BEGIN
  PERFORM public.check_card_limit('c1000000-0000-0000-0000-000000000002'::uuid, 100);  -- admin: no raise
END $$;

-- 8. NULL owner → authentication error (not a silent pass)
DO $$ DECLARE r boolean := false; BEGIN
  BEGIN PERFORM public.check_card_limit(NULL, 1);
  EXCEPTION WHEN OTHERS THEN r := true; END;
  ASSERT r, 'NULL owner should raise';
END $$;

-- 9. limit reads config
DO $$ BEGIN ASSERT public._owned_card_limit() = 3, '_owned_card_limit reads config'; END $$;

SELECT 'ALL_CARD_LIMIT_TESTS_PASSED' AS result;
ROLLBACK;
