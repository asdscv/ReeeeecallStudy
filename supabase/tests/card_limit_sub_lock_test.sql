-- ============================================================================
-- card_limit_sub_lock_test.sql — mig 140: over-cap SUBSCRIBED cards are study-locked.
--
-- Model: owned non-official cards keep priority; remaining slots fill with the OLDEST
-- subscriptions (whole deck); newest overflow subscribed decks are study-locked and
-- auto-restored when the cap rises. Mirrors the owned-card archive onto subscriptions.
-- Runs in a txn and ROLLBACKs.
-- ============================================================================
\set ON_ERROR_STOP on
\set u1 '''50000000-0000-0000-0000-000000000001'''
BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES
 ('50000000-0000-0000-0000-000000000001'),('50000000-0000-0000-0000-0000000000a1'),
 ('50000000-0000-0000-0000-0000000000b1'),('50000000-0000-0000-0000-0000000000c1') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES
 ('50000000-0000-0000-0000-000000000001','user'),('50000000-0000-0000-0000-0000000000a1','user'),
 ('50000000-0000-0000-0000-0000000000b1','user'),('50000000-0000-0000-0000-0000000000c1','user')
 ON CONFLICT (id) DO UPDATE SET role='user';
INSERT INTO card_templates (id,user_id,name) VALUES ('50000000-0000-0000-0000-0000000000ff', :u1,'T');

-- u1 owns 4 non-official cards (distinct created_at → deterministic owned boundary)
INSERT INTO decks (id,user_id,name) VALUES ('5d000000-0000-0000-0000-000000000001', :u1,'own');
INSERT INTO cards (deck_id,user_id,template_id,sort_position,created_at) VALUES
 ('5d000000-0000-0000-0000-000000000001', :u1,'50000000-0000-0000-0000-0000000000ff',1, now()-interval '40 min'),
 ('5d000000-0000-0000-0000-000000000001', :u1,'50000000-0000-0000-0000-0000000000ff',2, now()-interval '30 min'),
 ('5d000000-0000-0000-0000-000000000001', :u1,'50000000-0000-0000-0000-0000000000ff',3, now()-interval '20 min'),
 ('5d000000-0000-0000-0000-000000000001', :u1,'50000000-0000-0000-0000-0000000000ff',4, now()-interval '10 min');

-- decks A/B/C: 3 non-official cards each, subscribed oldest→newest
INSERT INTO decks (id,user_id,name) VALUES
 ('5d000000-0000-0000-0000-00000000000a','50000000-0000-0000-0000-0000000000a1','A'),
 ('5d000000-0000-0000-0000-00000000000b','50000000-0000-0000-0000-0000000000b1','B'),
 ('5d000000-0000-0000-0000-00000000000c','50000000-0000-0000-0000-0000000000c1','C');
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '5d000000-0000-0000-0000-00000000000a','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000ff',g FROM generate_series(1,3) g;
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '5d000000-0000-0000-0000-00000000000b','50000000-0000-0000-0000-0000000000b1','50000000-0000-0000-0000-0000000000ff',g FROM generate_series(1,3) g;
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '5d000000-0000-0000-0000-00000000000c','50000000-0000-0000-0000-0000000000c1','50000000-0000-0000-0000-0000000000ff',g FROM generate_series(1,3) g;
-- OFC: an OFFICIAL deck (in manifest), 5 cards, subscribed by u1 as the NEWEST share →
-- it must NEVER be study-locked even when all non-official subs overflow (mig 142).
INSERT INTO decks (id,user_id,name) VALUES ('5d000000-0000-0000-0000-00000000000f','50000000-0000-0000-0000-0000000000a1','OFC');
INSERT INTO cards (deck_id,user_id,template_id,sort_position) SELECT '5d000000-0000-0000-0000-00000000000f','50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000ff',g FROM generate_series(1,5) g;
INSERT INTO official_deck_manifest (manifest_key,deck_id,source_file,source_language,target_language,category,last_status)
  VALUES ('sublock-ofc','5d000000-0000-0000-0000-00000000000f','f.csv','en','ko','test','applied');
INSERT INTO deck_shares (deck_id,owner_id,recipient_id,share_mode,status,accepted_at) VALUES
 ('5d000000-0000-0000-0000-00000000000a','50000000-0000-0000-0000-0000000000a1', :u1,'subscribe','active', now()-interval '3 day'),
 ('5d000000-0000-0000-0000-00000000000b','50000000-0000-0000-0000-0000000000b1', :u1,'subscribe','active', now()-interval '2 day'),
 ('5d000000-0000-0000-0000-00000000000c','50000000-0000-0000-0000-0000000000c1', :u1,'subscribe','active', now()-interval '1 day'),
 ('5d000000-0000-0000-0000-00000000000f','50000000-0000-0000-0000-0000000000a1', :u1,'subscribe','active', now());
UPDATE card_limit_settings SET max_owned_cards=10, count_official_cards=false WHERE id=1;

SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000001',false);

-- ══ SLOTS: owned 4, remaining 6, A(3)+B(3) fit, C(3) locked ══
DO $$ DECLARE j json; BEGIN
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000a'), 'A active (oldest, fits)';
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000b'), 'B active (fits)';
  ASSERT NOT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000c'), 'C locked (overflow)';
  j := public.get_card_usage_detail();
  ASSERT (j->>'used_total')::int = 13, 'used_total = 4 owned + 9 subscribed';
  ASSERT (j->>'available')::int = 0, 'available 0';
  ASSERT (j->>'archived_total')::int = 3, 'archived_total = C (3 subscribed)';
  ASSERT public.get_deck_archived_count('5d000000-0000-0000-0000-00000000000c') = 3, 'C whole-deck archived count = 3';
  ASSERT public.get_deck_archived_count('5d000000-0000-0000-0000-00000000000a') = 0, 'A not archived';
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000f'), 'OFFICIAL sub deck active (excluded from slots, mig 142)';
END $$;

-- ══ AUTO-RESTORE: raise cap → nothing locked ══
UPDATE card_limit_settings SET max_owned_cards=100 WHERE id=1;
DO $$ BEGIN
  ASSERT public.get_subscribed_active_threshold() IS NULL, 'under cap → threshold NULL';
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000c'), 'C restored automatically';
  ASSERT (public.get_card_usage_detail()->>'archived_total')::int = 0, 'nothing archived under cap';
END $$;

-- ══ OWNED-OVER-CAP: owned alone exceeds cap → ALL subs locked + owned excess archived ══
UPDATE card_limit_settings SET max_owned_cards=2 WHERE id=1;   -- owned 4 > 2, remaining 0
DO $$ BEGIN
  ASSERT NOT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000a'), 'remaining 0 → even oldest sub A locked';
  -- ★ mig 142: the OFFICIAL subscribed deck stays active even when ALL non-official subs
  -- are locked, and is never counted as archived.
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000f'), 'OFFICIAL sub deck NEVER locked (over cap)';
  ASSERT public.get_deck_archived_count('5d000000-0000-0000-0000-00000000000f') = 0, 'official deck not archived';
  -- owned distinct created_at, cap 2 → cards 3,4 archived (2); all 9 NON-official subs locked (official excluded)
  ASSERT (public.get_card_usage_detail()->>'archived_total')::int = 2 + 9, 'archived = 2 owned + 9 subscribed (official excluded)';
END $$;

-- ══ UNLIMITED: nothing locked ══
UPDATE card_limit_settings SET max_owned_cards=2000000000 WHERE id=1;
DO $$ BEGIN
  ASSERT public.get_subscribed_active_threshold() IS NULL, 'unlimited → no sub lock';
  ASSERT public.is_subscribed_deck_active('5d000000-0000-0000-0000-00000000000c'), 'unlimited → C active';
END $$;

UPDATE card_limit_settings SET max_owned_cards=1000, count_official_cards=false WHERE id=1;
SELECT set_config('request.jwt.claim.role','',false);
SELECT set_config('request.jwt.claim.sub','',false);
SELECT 'ALL_SUB_LOCK_TESTS_PASSED' AS result;
ROLLBACK;
