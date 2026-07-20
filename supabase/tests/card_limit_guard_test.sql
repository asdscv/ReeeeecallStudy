-- ============================================================================
-- card_limit_guard_test.sql — mig 136 (insert trigger) + mig 137 (usage detail).
--
--   DRY-RUN  : get_card_usage_detail() reads never mutate; results are consistent.
--   SMOKE    : an authenticated DIRECT insert under the cap passes; at the cap the
--              trg_enforce_card_limit trigger blocks it (PT402) — closing the
--              POST /rest/v1/cards bypass that skips reserve_card_positions.
--   NET-ZERO : a BLOCKED direct insert writes NOTHING (row count unchanged).
--   BYPASS   : service_role (and admin) are EXEMPT; official-import ordering
--              (manifest written after cards) can never misclassify system cards.
--   BREAKDOWN: get_card_usage_detail() splits owned / subscribed / official-excluded
--              / archived exactly like _owned_card_count + the archive boundary.
--
-- Unlike the other card-limit tests, this one runs with triggers ENABLED
-- (session_replication_role = DEFAULT) after seeding, and drives auth via
-- request.jwt.claim.role/sub. Runs in a txn and ROLLBACKs → leaves no data.
-- ============================================================================
\set ON_ERROR_STOP on
\set u1  '''e1000000-0000-0000-0000-000000000001'''
\set adm '''e1000000-0000-0000-0000-000000000002'''
\set pub '''e1000000-0000-0000-0000-000000000003'''
\set sys '''00000000-0000-0000-0000-000000000001'''

BEGIN;

-- ── Seed fixtures past triggers (profiles.role guard needs replica) ──
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:u1),(:adm),(:pub),(:sys) ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, role) VALUES
  (:u1,'user'),(:adm,'admin'),(:pub,'user'),(:sys,'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
-- sys = the system/official importer (skipped by fixed id). pub = a badge-granted
-- is_official publisher who is NOT the system user → must still be capped (mig 136 skip
-- gates on the system-user id, not the grantable is_official flag).
UPDATE profiles SET is_official = true WHERE id IN (:sys, :pub);

INSERT INTO card_templates (id, user_id, name) VALUES
  ('71000000-0000-0000-0000-000000000001', :u1,  'Tu1'),
  ('71000000-0000-0000-0000-000000000002', :adm, 'Tadm'),
  ('71000000-0000-0000-0000-000000000003', :pub, 'Tpub'),
  ('71000000-0000-0000-0000-000000000004', :sys, 'Tsys');

-- d_own: u1-owned non-official; d_adm: admin-owned; d_pub: pub non-official (subscribed
-- by u1); d_official: sys deck IN manifest (subscribed by u1); d_sysimport: sys deck NOT
-- in manifest (simulates a mid-import state).
INSERT INTO decks (id, user_id, name) VALUES
  ('41000000-0000-0000-0000-000000000001', :u1,  'd_own'),
  ('41000000-0000-0000-0000-000000000002', :adm, 'd_adm'),
  ('41000000-0000-0000-0000-000000000003', :pub, 'd_pub'),
  ('41000000-0000-0000-0000-000000000004', :sys, 'd_official'),
  ('41000000-0000-0000-0000-000000000005', :sys, 'd_sysimport');

-- u1 owns 2 non-official cards, with DISTINCT created_at so the archive boundary is
-- deterministic (ties would stay active).
INSERT INTO cards (deck_id, user_id, template_id, sort_position, created_at) VALUES
  ('41000000-0000-0000-0000-000000000001', :u1, '71000000-0000-0000-0000-000000000001', 1, now() - interval '2 min'),
  ('41000000-0000-0000-0000-000000000001', :u1, '71000000-0000-0000-0000-000000000001', 2, now() - interval '1 min');

-- pub deck: 3 non-official cards (u1 subscribes → owned_subscribed)
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '41000000-0000-0000-0000-000000000003', :pub, '71000000-0000-0000-0000-000000000003', g
FROM generate_series(1,3) g;

-- official deck: 4 cards, deck listed in the manifest (u1 subscribes → official_excluded)
INSERT INTO cards (deck_id, user_id, template_id, sort_position)
SELECT '41000000-0000-0000-0000-000000000004', :sys, '71000000-0000-0000-0000-000000000004', g
FROM generate_series(1,4) g;
INSERT INTO official_deck_manifest (manifest_key, deck_id, source_file, source_language, target_language, category, last_status)
  VALUES ('clg-official','41000000-0000-0000-0000-000000000004','f.csv','en','ko','test','applied');

-- u1's two active subscribe shares
INSERT INTO deck_shares (deck_id, owner_id, recipient_id, share_mode, status, accepted_at) VALUES
  ('41000000-0000-0000-0000-000000000003', :pub, :u1, 'subscribe', 'active', now()),
  ('41000000-0000-0000-0000-000000000004', :sys, :u1, 'subscribe', 'active', now());

UPDATE card_limit_settings SET max_owned_cards = 3, count_official_cards = false WHERE id = 1;

-- ══ Triggers ON from here ══
SET session_replication_role = DEFAULT;

-- ── auth as u1 (authenticated) ──
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000001', false);

-- ════════════════ DRY-RUN: get_card_usage_detail reads don't mutate ════════════════
-- Cap=3; u1 has owned_own=2, owned_subscribed=3 → used_total=5 (ALREADY over cap; that
-- is fine — the cap blocks NEW inserts, it doesn't retro-delete). official_excluded=4.
DO $$
DECLARE j1 json; j2 json; n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards;
  j1 := public.get_card_usage_detail();
  j2 := public.get_card_usage_detail();
  SELECT count(*) INTO n_after FROM cards;
  ASSERT n_before = n_after, 'DRY-RUN: usage read wrote no rows';
  ASSERT (j1->>'owned_own')::int = 2,          'DRY-RUN: owned_own=2';
  ASSERT (j1->>'owned_subscribed')::int = 3,   'DRY-RUN: owned_subscribed=3';
  ASSERT (j1->>'used_total')::int = 5,         'DRY-RUN: used_total=5';
  ASSERT (j1->>'official_excluded')::int = 4,  'DRY-RUN: official_excluded=4';
  ASSERT (j1->>'card_limit')::int = 3,         'DRY-RUN: card_limit=3';
  ASSERT (j1->>'available')::int = 0,          'DRY-RUN: available=greatest(3-5,0)=0';
  ASSERT (j1->>'is_unlimited')::boolean = false,'DRY-RUN: not unlimited';
  ASSERT j1::text = j2::text,                  'DRY-RUN: reads consistent';
END $$;

-- ════════════════ SMOKE + NET-ZERO: over-cap authenticated insert BLOCKED ════════════
-- u1 is already at used_total=5 > cap 3. A direct insert must be blocked and write nothing.
DO $$
DECLARE n_before int; n_after int; blocked boolean := false;
BEGIN
  SELECT count(*) INTO n_before FROM cards;
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, sort_position)
      VALUES ('41000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',
              '71000000-0000-0000-0000-000000000001', 99);
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  SELECT count(*) INTO n_after FROM cards;
  ASSERT blocked, 'SMOKE: over-cap direct authenticated insert blocked (PT402)';
  ASSERT n_before = n_after, 'NET-ZERO: blocked insert wrote no row';
END $$;

-- SMOKE (allow): drop u1 under the cap, then a direct insert MUST pass through the trigger.
-- Remove both subscribe shares so used_total = owned_own = 2 < cap 3.
SET session_replication_role = replica;
DELETE FROM deck_shares WHERE recipient_id = :u1;
SET session_replication_role = DEFAULT;
DO $$
DECLARE n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards;
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)   -- 2+1 = 3 = cap → OK
    VALUES ('41000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',
            '71000000-0000-0000-0000-000000000001', 3);
  SELECT count(*) INTO n_after FROM cards;
  ASSERT n_after = n_before + 1, 'SMOKE: under-cap direct insert passes the trigger';
END $$;

-- One more (now at cap 3) must block again (multi-row array insert → single statement).
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, sort_position) VALUES
      ('41000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001', 4),
      ('41000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001', 5);
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  ASSERT blocked, 'SMOKE: at-cap array insert (single statement) blocked';
END $$;

-- ════════════════ BYPASS: service_role is EXEMPT (incl. official-import order) ═══════
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$
DECLARE n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards;
  -- system user inserting into a deck NOT YET in the manifest (mid-import) — must NOT be
  -- blocked and must NOT be misclassified, because the role gate skips service_role.
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)
  SELECT '41000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',
         '71000000-0000-0000-0000-000000000004', g FROM generate_series(1,10) g;   -- 10 > cap 3
  SELECT count(*) INTO n_after FROM cards;
  ASSERT n_after = n_before + 10, 'BYPASS: service_role insert over cap is allowed (import-safe)';
END $$;

-- ════════════════ ADMIN bypass: authenticated admin over the cap passes ══════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000002', false);
-- adm owns 0 cards; put adm over cap first (as service_role to set up), then insert as adm.
DO $$
DECLARE n_before int; n_after int;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role', false);
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)
  SELECT '41000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002',
         '71000000-0000-0000-0000-000000000002', g FROM generate_series(1,5) g;   -- adm now 5 > cap 3
  PERFORM set_config('request.jwt.claim.role','authenticated', false);
  PERFORM set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000002', false);
  SELECT count(*) INTO n_before FROM cards;
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)   -- admin: never capped
    VALUES ('41000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002',
            '71000000-0000-0000-0000-000000000002', 6);
  SELECT count(*) INTO n_after FROM cards;
  ASSERT n_after = n_before + 1, 'ADMIN: over-cap admin direct insert allowed';
END $$;

-- ════════════════ UNLIMITED sentinel: never blocked, never scans ════════════════════
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000001', false);
UPDATE card_limit_settings SET max_owned_cards = 2000000000 WHERE id = 1;  -- 2e9 = unlimited
DO $$
DECLARE n_before int; n_after int;
BEGIN
  ASSERT public._owned_card_over_cap('e1000000-0000-0000-0000-000000000001'::uuid) = false,
         'UNLIMITED: over_cap short-circuits to false';
  SELECT count(*) INTO n_before FROM cards;
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)
    VALUES ('41000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001',
            '71000000-0000-0000-0000-000000000001', 100);
  SELECT count(*) INTO n_after FROM cards;
  ASSERT n_after = n_before + 1, 'UNLIMITED: insert always allowed';
END $$;

-- ════════════════ BREAKDOWN + ARCHIVE: get_card_usage_detail account-wide roll-up ════
-- Re-add u1's subscribe shares; set a tiny cap so u1's 2 owned non-official cards go
-- over → the NEWER owned card (created_at -1min) is archived past the boundary.
SET session_replication_role = replica;
INSERT INTO deck_shares (deck_id, owner_id, recipient_id, share_mode, status, accepted_at) VALUES
  ('41000000-0000-0000-0000-000000000003', :pub, :u1, 'subscribe', 'active', now()),
  ('41000000-0000-0000-0000-000000000004', :sys, :u1, 'subscribe', 'active', now())
ON CONFLICT DO NOTHING;
-- delete the extra owned cards added above so u1 owns exactly the original 2 (distinct ts)
DELETE FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000001' AND sort_position IN (3,100);
SET session_replication_role = DEFAULT;
UPDATE card_limit_settings SET max_owned_cards = 1 WHERE id = 1;
DO $$
DECLARE j json;
BEGIN
  j := public.get_card_usage_detail();
  ASSERT (j->>'owned_own')::int = 2,        'BREAKDOWN: owned_own=2';
  ASSERT (j->>'owned_subscribed')::int = 3, 'BREAKDOWN: owned_subscribed=3 (pub deck)';
  ASSERT (j->>'official_excluded')::int = 4,'BREAKDOWN: official_excluded=4 (manifest deck)';
  ASSERT (j->>'card_limit')::int = 1,       'BREAKDOWN: card_limit=1';
  -- mig 140: archived_total = owned excess (1) + locked subscribed (pub deck, 3;
  -- owned=2 fills the cap of 1 → remaining 0 → all subs locked). Official deck excluded.
  ASSERT (j->>'archived_total')::int = 4,   'BREAKDOWN: 1 owned + 3 subscribed archived';
END $$;

-- ════════════════ M1: accept_invite SUBSCRIBE branch enforces the cap (mig 138) ══════
-- Remove u1's subscribe shares, create a PENDING subscribe invite for pub's 3-card
-- non-official deck, and set a cap where accepting would push u1 over.
SET session_replication_role = replica;
DELETE FROM deck_shares WHERE recipient_id = :u1;
DELETE FROM user_card_progress WHERE user_id = :u1;
INSERT INTO deck_shares (deck_id, owner_id, recipient_id, share_mode, status, invite_code)
  VALUES ('41000000-0000-0000-0000-000000000003', :pub, NULL, 'subscribe', 'pending', 'clg-invite-1');
SET session_replication_role = DEFAULT;
UPDATE card_limit_settings SET max_owned_cards = 4 WHERE id = 1;   -- u1 owns 2; +3 = 5 > 4
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE blocked boolean := false; v_status text;
BEGIN
  BEGIN PERFORM public.accept_invite('clg-invite-1');
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  ASSERT blocked, 'M1: over-cap subscribe accept_invite blocked (PT402)';
  SELECT status INTO v_status FROM deck_shares WHERE invite_code='clg-invite-1';
  ASSERT v_status = 'pending', 'M1: blocked accept leaves the share PENDING (net-zero, not activated)';
END $$;
-- Under the cap → accept succeeds and the share activates.
UPDATE card_limit_settings SET max_owned_cards = 10 WHERE id = 1;   -- 2+3 = 5 <= 10
DO $$
DECLARE v_status text;
BEGIN
  PERFORM public.accept_invite('clg-invite-1');
  SELECT status INTO v_status FROM deck_shares WHERE invite_code='clg-invite-1';
  ASSERT v_status = 'active', 'M1: under-cap subscribe accept activates the share';
END $$;

-- ════════════════ L3: is_official (system) owner is NOT false-blocked by the trigger ══
-- An authenticated insert into a SYSTEM-user-owned deck NOT in the manifest (mid-import
-- shape), over cap — must be ALLOWED because the owner is is_official.
UPDATE card_limit_settings SET max_owned_cards = 2 WHERE id = 1;   -- sys already has 10 in d_sysimport
DO $$
DECLARE n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000005';
  INSERT INTO cards (deck_id, user_id, template_id, sort_position)
    VALUES ('41000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',
            '71000000-0000-0000-0000-000000000004', 99);
  SELECT count(*) INTO n_after FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000005';
  ASSERT n_after = n_before + 1, 'L3: authenticated insert into system-user deck not blocked';
END $$;

-- ════════════════ Code#1: a NON-system is_official publisher IS still capped ══════════
-- pub is is_official=true but NOT the system user → the trigger must enforce the cap on
-- pub's own over-cap direct insert (the is_official-too-broad hole is closed).
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000003', false);  -- pub
UPDATE card_limit_settings SET max_owned_cards = 2 WHERE id = 1;   -- pub owns 3 in d_pub > 2
DO $$
DECLARE blocked boolean := false; n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000003';
  BEGIN
    INSERT INTO cards (deck_id, user_id, template_id, sort_position)
      VALUES ('41000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000003',
              '71000000-0000-0000-0000-000000000003', 99);
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  SELECT count(*) INTO n_after FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000003';
  ASSERT blocked, 'Code#1: non-system is_official publisher IS capped (PT402)';
  ASSERT n_after = n_before, 'Code#1: net-zero on block';
END $$;

-- ════════════════ Code#2: admin effective limit is unlimited → NOT archived (mig 139) ═
-- adm owns > cap cards; with the admin branch in _owned_card_limit, the archive boundary
-- must be NULL (nothing archived) and the meter must read unlimited.
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000002', false);  -- adm
UPDATE card_limit_settings SET max_owned_cards = 2 WHERE id = 1;   -- adm owns 6 in d_adm > 2
DO $$
DECLARE j json;
BEGIN
  ASSERT public._owned_card_limit('e1000000-0000-0000-0000-000000000002'::uuid) = 2000000000,
         'Code#2: admin _owned_card_limit = unlimited sentinel';
  ASSERT public.get_active_card_threshold() IS NULL,
         'Code#2: admin over cap → archive threshold NULL (not archived)';
  j := public.get_card_usage_detail();
  ASSERT (j->>'is_unlimited')::boolean = true, 'Code#2: admin meter is_unlimited';
  ASSERT (j->>'archived_total')::int = 0,      'Code#2: admin archived_total = 0';
END $$;

-- ════════════════ bulk_insert_cards: set-based (mig 138) inserts all, pre-check blocks ═
-- u1 under cap: a bulk insert of 3 cards into u1's own deck succeeds in one statement.
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub',  'e1000000-0000-0000-0000-000000000001', false);
UPDATE card_limit_settings SET max_owned_cards = 1000 WHERE id = 1;
SET session_replication_role = replica;   -- drop the pub subscribe so u1's count is just owned
DELETE FROM deck_shares WHERE recipient_id = :u1;
SET session_replication_role = DEFAULT;
DO $$
DECLARE res jsonb; n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000001';
  res := public.bulk_insert_cards(
    '41000000-0000-0000-0000-000000000001'::uuid,
    '71000000-0000-0000-0000-000000000001'::uuid,
    '[{"field_values":{"front":"a"}},{"field_values":{"front":"b"}},{"field_values":{"front":"c"}}]'::jsonb);
  SELECT count(*) INTO n_after FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000001';
  ASSERT (res->>'inserted')::int = 3, 'bulk: reports 3 inserted';
  ASSERT n_after = n_before + 3, 'bulk: 3 rows actually inserted (single set-based statement)';
END $$;
-- Over-cap bulk is blocked up-front by check_card_limit (nothing inserted).
UPDATE card_limit_settings SET max_owned_cards = 1 WHERE id = 1;   -- u1 already over
DO $$
DECLARE blocked boolean := false; n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000001';
  BEGIN PERFORM public.bulk_insert_cards(
    '41000000-0000-0000-0000-000000000001'::uuid,
    '71000000-0000-0000-0000-000000000001'::uuid,
    '[{"field_values":{"front":"x"}}]'::jsonb);
  EXCEPTION WHEN sqlstate 'PT402' THEN blocked := true; END;
  SELECT count(*) INTO n_after FROM cards WHERE deck_id='41000000-0000-0000-0000-000000000001';
  ASSERT blocked, 'bulk: over-cap blocked (PT402)';
  ASSERT n_after = n_before, 'bulk: net-zero on block';
END $$;

UPDATE card_limit_settings SET max_owned_cards = 1000, count_official_cards = false WHERE id = 1;
SELECT set_config('request.jwt.claim.role', '', false);
SELECT set_config('request.jwt.claim.sub',  '', false);

SELECT 'ALL_CARD_LIMIT_GUARD_TESTS_PASSED' AS result;
ROLLBACK;
