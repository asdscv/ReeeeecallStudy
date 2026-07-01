-- ============================================================================
-- card_limit_smoke_test.sql — owned-card limit (mig 116): DRY-RUN / SMOKE / NET-ZERO.
--   DRY-RUN  : reading usage/count never mutates state.
--   SMOKE    : under the cap passes; at the cap the guard blocks (PT402).
--   NET-ZERO : a BLOCKED create moves NOTHING — reserve_card_positions raises
--              BEFORE its UPDATE, so next_position is not consumed and no card is
--              inserted (contrasted against a permitted reserve that DOES advance).
-- Runs in a txn and ROLLBACKs → leaves no data.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET session_replication_role = replica;  -- seed fixtures past triggers (profiles.role guard)

INSERT INTO auth.users (id) VALUES ('d1000000-0000-0000-0000-000000000001') ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, role) VALUES ('d1000000-0000-0000-0000-000000000001','user')
  ON CONFLICT (id) DO UPDATE SET role = 'user';
INSERT INTO card_templates (id, user_id, name)
  VALUES ('7d000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','T');
INSERT INTO decks (id, user_id, name)
  VALUES ('4d000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','D');
UPDATE card_limit_settings SET max_owned_cards = 5, count_official_cards = false WHERE id = 1;

-- start at 2 owned cards
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '4d000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
       '7d000000-0000-0000-0000-000000000001', g FROM generate_series(1,2) g;

-- ══ DRY-RUN: usage/count reads must not mutate ══
DO $$ DECLARE a int; b int; n_before int; n_after int; BEGIN
  SELECT count(*) INTO n_before FROM cards WHERE deck_id='4d000000-0000-0000-0000-000000000001';
  a := public._owned_card_count('d1000000-0000-0000-0000-000000000001'::uuid);
  b := public._owned_card_count('d1000000-0000-0000-0000-000000000001'::uuid);
  SELECT count(*) INTO n_after FROM cards WHERE deck_id='4d000000-0000-0000-0000-000000000001';
  ASSERT a = 2 AND b = 2, 'DRY-RUN: count reads consistent';
  ASSERT n_before = n_after AND n_after = 2, 'DRY-RUN: reads wrote no rows';
END $$;

-- ══ SMOKE: under cap passes, at cap blocks ══
DO $$ BEGIN PERFORM public.check_card_limit('d1000000-0000-0000-0000-000000000001'::uuid, 3); END $$;  -- 2+3=5 ok
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '4d000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
       '7d000000-0000-0000-0000-000000000001', g FROM generate_series(3,5) g;  -- now 5 owned = cap
DO $$ DECLARE r boolean := false; BEGIN
  BEGIN PERFORM public.check_card_limit('d1000000-0000-0000-0000-000000000001'::uuid, 1);
  EXCEPTION WHEN sqlstate 'PT402' THEN r := true; END;
  ASSERT r, 'SMOKE: blocked at cap (PT402)';
END $$;

-- ══ NET-ZERO: a blocked reserve moves nothing ══
SET LOCAL "request.jwt.claim.role" = 'service_role';  -- so reserve_card_positions UPDATE matches
DO $$
DECLARE np_before int; cnt_before int; np_after int; cnt_after int; r boolean := false;
BEGIN
  SELECT next_position INTO np_before FROM decks WHERE id='4d000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO cnt_before FROM cards WHERE deck_id='4d000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM public.reserve_card_positions('4d000000-0000-0000-0000-000000000001'::uuid, 1);  -- 5+1 > 5
  EXCEPTION WHEN sqlstate 'PT402' THEN r := true; END;
  SELECT next_position INTO np_after FROM decks WHERE id='4d000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO cnt_after FROM cards WHERE deck_id='4d000000-0000-0000-0000-000000000001';
  ASSERT r, 'NET-ZERO: reserve blocked at cap';
  ASSERT np_before = np_after, 'NET-ZERO: next_position NOT consumed by a blocked reserve';
  ASSERT cnt_before = cnt_after, 'NET-ZERO: no card row written by a blocked reserve';
END $$;

-- Contrast: a PERMITTED reserve DOES advance next_position (proves net-zero is the block, not a no-op fn).
DELETE FROM cards WHERE deck_id='4d000000-0000-0000-0000-000000000001' AND sort_position=5;  -- 4 owned
DO $$ DECLARE np_b int; np_a int; BEGIN
  SELECT next_position INTO np_b FROM decks WHERE id='4d000000-0000-0000-0000-000000000001';
  PERFORM public.reserve_card_positions('4d000000-0000-0000-0000-000000000001'::uuid, 1);  -- 4+1=5 ok
  SELECT next_position INTO np_a FROM decks WHERE id='4d000000-0000-0000-0000-000000000001';
  ASSERT np_a = np_b + 1, 'permitted reserve advances next_position by 1';
END $$;

UPDATE card_limit_settings SET max_owned_cards = 1000, count_official_cards = false WHERE id = 1;
SELECT 'ALL_CARD_LIMIT_SMOKE_TESTS_PASSED' AS result;
ROLLBACK;
