-- ============================================================================
-- card_limit_rls_test.sql — mig 141 RLS hardening.
--   L2: a SUBSCRIBE share reactivated (status → active) over the cap is BLOCKED by
--       the BEFORE UPDATE trigger; under cap it succeeds; non-subscribe / official
--       reactivations are unaffected.
--   L5: cards RLS WITH CHECK forbids inserting a card into a deck the caller does
--       NOT own (tested under SET ROLE authenticated, since postgres bypasses RLS).
-- Runs in a txn and ROLLBACKs.
-- ============================================================================
\set ON_ERROR_STOP on
\set u1 '''61000000-0000-0000-0000-000000000001'''
\set u2 '''61000000-0000-0000-0000-000000000002'''
\set pb '''61000000-0000-0000-0000-000000000003'''
BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:u1),(:u2),(:pb) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:u1,'user'),(:u2,'user'),(:pb,'user')
  ON CONFLICT (id) DO UPDATE SET role='user';
INSERT INTO card_templates (id,user_id,name) VALUES ('61100000-0000-0000-0000-0000000000ff', :u1,'T');

-- publisher deck A: 5 non-official cards; official deck O: 4 cards in manifest
INSERT INTO decks (id,user_id,name) VALUES
  ('6d000000-0000-0000-0000-00000000000a', :pb,'A'),
  ('6d000000-0000-0000-0000-0000000000cc', :pb,'O');
INSERT INTO cards (deck_id,user_id,template_id,sort_position)
  SELECT '6d000000-0000-0000-0000-00000000000a', :pb,'61100000-0000-0000-0000-0000000000ff',g FROM generate_series(1,5) g;
INSERT INTO cards (deck_id,user_id,template_id,sort_position)
  SELECT '6d000000-0000-0000-0000-0000000000cc', :pb,'61100000-0000-0000-0000-0000000000ff',g FROM generate_series(1,4) g;
INSERT INTO official_deck_manifest (manifest_key, deck_id, source_file, source_language, target_language, category, last_status)
  VALUES ('rls-official','6d000000-0000-0000-0000-0000000000cc','f.csv','en','ko','test','applied');

-- u1's REVOKED subscribe shares (seeded past triggers)
INSERT INTO deck_shares (deck_id, owner_id, recipient_id, share_mode, status, accepted_at) VALUES
  ('6d000000-0000-0000-0000-00000000000a', :pb, :u1, 'subscribe', 'revoked', now()),
  ('6d000000-0000-0000-0000-0000000000cc', :pb, :u1, 'subscribe', 'revoked', now());

-- u1 + u2 owned decks for L5
INSERT INTO decks (id,user_id,name) VALUES
  ('6d000000-0000-0000-0000-000000000001', :u1,'u1deck'),
  ('6d000000-0000-0000-0000-000000000002', :u2,'u2deck');

UPDATE card_limit_settings SET max_owned_cards=3, count_official_cards=false WHERE id=1;
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',false);  -- u1

-- ══ L2: reactivate deck A (5 cards) over cap 3 → BLOCKED ══
DO $$
DECLARE blocked boolean := false; v_status text;
BEGIN
  BEGIN
    UPDATE deck_shares SET status='active'
      WHERE deck_id='6d000000-0000-0000-0000-00000000000a' AND recipient_id='61000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  SELECT status INTO v_status FROM deck_shares
    WHERE deck_id='6d000000-0000-0000-0000-00000000000a' AND recipient_id='61000000-0000-0000-0000-000000000001';
  ASSERT blocked, 'L2: over-cap subscribe reactivation blocked (PT402)';
  ASSERT v_status = 'revoked', 'L2: blocked reactivation left status revoked (net-zero)';
END $$;

-- ══ L2: OFFICIAL deck reactivation → v_add 0 → allowed even at cap ══
DO $$ BEGIN
  UPDATE deck_shares SET status='active'
    WHERE deck_id='6d000000-0000-0000-0000-0000000000cc' AND recipient_id='61000000-0000-0000-0000-000000000001';
  ASSERT (SELECT status FROM deck_shares WHERE deck_id='6d000000-0000-0000-0000-0000000000cc' AND recipient_id='61000000-0000-0000-0000-000000000001') = 'active',
         'L2: official-deck reactivation not blocked (excluded from cap)';
END $$;

-- ══ L2: raise cap → deck A reactivation now succeeds ══
UPDATE card_limit_settings SET max_owned_cards=10 WHERE id=1;
DO $$ BEGIN
  UPDATE deck_shares SET status='active'
    WHERE deck_id='6d000000-0000-0000-0000-00000000000a' AND recipient_id='61000000-0000-0000-0000-000000000001';
  ASSERT (SELECT status FROM deck_shares WHERE deck_id='6d000000-0000-0000-0000-00000000000a' AND recipient_id='61000000-0000-0000-0000-000000000001') = 'active',
         'L2: under-cap reactivation succeeds';
END $$;

-- ══ L5: cards WITH CHECK — run as the authenticated ROLE so RLS applies ══
GRANT INSERT, SELECT ON public.cards TO authenticated;  -- ensure grant present in test DB
SET LOCAL ROLE authenticated;
-- own deck → allowed
DO $$ BEGIN
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)
    VALUES ('6d000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','61100000-0000-0000-0000-0000000000ff',1);
END $$;
-- another user's deck → WITH CHECK fails (RLS violation)
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, sort_position)
      VALUES ('6d000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','61100000-0000-0000-0000-0000000000ff',1);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN blocked := true; END;
  ASSERT blocked, 'L5: inserting a card into another user''s deck is blocked by WITH CHECK';
END $$;
RESET ROLE;

UPDATE card_limit_settings SET max_owned_cards=1000, count_official_cards=false WHERE id=1;
SELECT set_config('request.jwt.claim.role','',false);
SELECT set_config('request.jwt.claim.sub','',false);
SELECT 'ALL_CARD_LIMIT_RLS_TESTS_PASSED' AS result;
ROLLBACK;
