-- ============================================================================
-- account_deletion_test.sql — delete_user_account() destroys the account and
-- KEEPS the records a payment dispute needs (mig 180).
--
-- WHY THIS EXISTS. Both clients have called this RPC since the settings screens
-- shipped, and it never existed — in the repo, in git history, or in production.
-- Deletion silently did not work while privacy-policy.html promised removal.
--
-- The thing that makes it hard is not the delete, it is the two-sided
-- requirement: everything personal must go, and the payment/consent evidence
-- must NOT, because all seven financial tables are ON DELETE CASCADE. A test
-- that only checks "the auth row is gone" would pass on an implementation that
-- destroyed the evidence defending every chargeback.
--
-- What is pinned:
--   1. the account and its content are actually gone;
--   2. the money rows SURVIVE, in a table with no FK to auth.users, still tied
--      to the person by id and by the email as it stood at deletion;
--   3. the five NO ACTION foreign keys that abort a naive DELETE are handled —
--      this is the failure the feature was missing, verified by running it;
--   4. a third party's email stored on someone ELSE's row is scrubbed;
--   5. the caller can only delete themselves, and the retained table is
--      unreadable by any client;
--   6. retention ends: the purge is admin-only and respects its window.
--
-- Runs in a txn and ROLLBACKs. Connection role is superuser, so GRANTs never
-- block; role behaviour is simulated with request.jwt claims and privileges are
-- asserted with has_function_privilege / has_table_privilege.
-- ============================================================================
\set ON_ERROR_STOP on
\set doomed '''da000000-0000-0000-0000-0000000000d1'''
\set keeper '''da000000-0000-0000-0000-0000000000d2'''
\set adm    '''da000000-0000-0000-0000-0000000000a9'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES
  (:doomed, 'doomed@example.test'),
  (:keeper, 'keeper@example.test'),
  (:adm,    'adm@example.test');
INSERT INTO profiles (id, role) VALUES (:doomed,'user'),(:keeper,'user'),(:adm,'admin')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

-- ── content the learner owns ────────────────────────────────────────────────
INSERT INTO card_templates (id, user_id, name, fields)
  VALUES ('da000000-0000-0000-0000-0000000000c0', :doomed, 'T', '[]'::jsonb);
INSERT INTO decks (id, user_id, name) VALUES ('da000000-0000-0000-0000-0000000000e0', :doomed, 'D');
INSERT INTO cards (id, deck_id, user_id, template_id, field_values)
  VALUES ('da000000-0000-0000-0000-0000000000f0', 'da000000-0000-0000-0000-0000000000e0', :doomed,
          'da000000-0000-0000-0000-0000000000c0', '{}'::jsonb);

-- ── the five NO ACTION foreign keys that abort a naive delete ───────────────
INSERT INTO marketplace_listings (id, deck_id, owner_id, title, share_mode)
  VALUES ('da000000-0000-0000-0000-0000000000b0', 'da000000-0000-0000-0000-0000000000e0', :doomed, 'L', 'copy');
INSERT INTO marketplace_views (listing_id, viewer_id)
  VALUES ('da000000-0000-0000-0000-0000000000b0', :doomed);
-- A listing owned by someone ELSE, so the report/view rows are not swept away by
-- the owner cascade — this is what actually exercises the blocker handling.
INSERT INTO decks (id, user_id, name) VALUES ('da000000-0000-0000-0000-0000000000e1', :keeper, 'K');
INSERT INTO marketplace_listings (id, deck_id, owner_id, title, share_mode)
  VALUES ('da000000-0000-0000-0000-0000000000b1', 'da000000-0000-0000-0000-0000000000e1', :keeper, 'KL', 'copy');
INSERT INTO marketplace_views (listing_id, viewer_id)
  VALUES ('da000000-0000-0000-0000-0000000000b1', :doomed);
INSERT INTO marketplace_reports (listing_id, reporter_id, category)
  VALUES ('da000000-0000-0000-0000-0000000000b1', :doomed, 'spam');

-- ── the third party's address stored on the KEEPER's row ────────────────────
INSERT INTO deck_shares (id, deck_id, owner_id, share_mode, invite_email)
  VALUES ('da000000-0000-0000-0000-0000000000a0', 'da000000-0000-0000-0000-0000000000e1', :keeper, 'copy', 'Doomed@Example.Test');

-- ── money: the rows that must OUTLIVE the account ───────────────────────────
INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, status, merchant_uid, paid_at)
  VALUES (:doomed, 'credits_1000', 'credit_pack', 5000, 'paid', 'muid-doomed-1', now());
INSERT INTO ai_credit_ledger (user_id, delta, reason, balance_after)
  VALUES (:doomed, 1000000, 'purchase', 1000000);
INSERT INTO ai_credit_balance (user_id, balance) VALUES (:doomed, 1000000)
  ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance;

-- ═══ 1) a naive delete really would abort — the premise of the feature ══════
-- Proven rather than asserted in a comment: without the blocker handling, the
-- whole statement raises, which is why deletion never worked.
DO $$
BEGIN
  BEGIN
    DELETE FROM auth.users WHERE id = 'da000000-0000-0000-0000-0000000000d1';
    RAISE EXCEPTION 'a naive delete unexpectedly SUCCEEDED — the blocker set changed';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- expected
  END;
END $$;

-- ═══ 2) the caller deletes their own account ═══════════════════════════════
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','da000000-0000-0000-0000-0000000000d1',false);
DO $$
DECLARE r json;
BEGIN
  r := public.delete_user_account();
  ASSERT (r->>'deleted')::boolean, 'the call reports success';
  -- 1 payment_intent + 1 ledger row + 1 balance row
  ASSERT (r->>'retained_records')::int = 3,
    format('three money rows retained, got %s', r->>'retained_records');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', NULL, false);

-- ═══ 3) the account and its content are gone ═══════════════════════════════
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'da000000-0000-0000-0000-0000000000d1'),
    'the auth row is deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM cards WHERE user_id = 'da000000-0000-0000-0000-0000000000d1'),
    'cards cascade away';
  ASSERT NOT EXISTS (SELECT 1 FROM decks WHERE user_id = 'da000000-0000-0000-0000-0000000000d1'),
    'decks cascade away';
  ASSERT NOT EXISTS (SELECT 1 FROM card_templates WHERE user_id = 'da000000-0000-0000-0000-0000000000d1'),
    'templates cascade away';
  ASSERT NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'da000000-0000-0000-0000-0000000000d1'),
    'the profile cascades away';
  -- The other user is untouched. A deletion that reaches into someone else's
  -- account is the worst possible failure of this function.
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = 'da000000-0000-0000-0000-0000000000d2'),
    'the other account survives';
  ASSERT EXISTS (SELECT 1 FROM decks WHERE user_id = 'da000000-0000-0000-0000-0000000000d2'),
    'the other account keeps its decks';
END $$;

-- ═══ 4) the money survived, still attributable ═════════════════════════════
DO $$
DECLARE pi jsonb;
BEGIN
  ASSERT (SELECT count(*) FROM billing_retention
           WHERE deleted_user_id = 'da000000-0000-0000-0000-0000000000d1') = 3,
    'the retention record survives the cascade';

  SELECT record INTO pi FROM billing_retention
   WHERE deleted_user_id = 'da000000-0000-0000-0000-0000000000d1'
     AND source_table = 'payment_intents';

  -- The whole row, not a summary: the amount and the provider reference are what
  -- a chargeback is answered with.
  ASSERT pi->>'merchant_uid' = 'muid-doomed-1', 'the provider reference is kept';
  ASSERT (pi->>'amount_krw')::int = 5000, 'the amount is kept';
  ASSERT (SELECT email FROM billing_retention
           WHERE deleted_user_id = 'da000000-0000-0000-0000-0000000000d1' LIMIT 1)
         = 'doomed@example.test',
    'the email as it stood at deletion is kept — a dispute names a person, not a uuid';
  ASSERT (SELECT occurred_at FROM billing_retention
           WHERE source_table = 'payment_intents'
             AND deleted_user_id = 'da000000-0000-0000-0000-0000000000d1') IS NOT NULL,
    'the retention clock has a date to run on';
END $$;

-- ═══ 5) the blockers were handled, not bulldozed ═══════════════════════════
DO $$
BEGIN
  -- De-identified, not deleted: the listing owner keeps the view count.
  ASSERT EXISTS (SELECT 1 FROM marketplace_views
                  WHERE listing_id = 'da000000-0000-0000-0000-0000000000b1' AND viewer_id IS NULL),
    'the view on someone else''s listing survives with no viewer';
  ASSERT NOT EXISTS (SELECT 1 FROM marketplace_views
                      WHERE viewer_id = 'da000000-0000-0000-0000-0000000000d1'),
    'no view still names the deleted user';
  -- reporter_id is NOT NULL, so the row itself has to go.
  ASSERT NOT EXISTS (SELECT 1 FROM marketplace_reports
                      WHERE reporter_id = 'da000000-0000-0000-0000-0000000000d1'),
    'the report filed by the deleted user is removed';
END $$;

-- ═══ 6) a third party's address on someone else's row is scrubbed ══════════
DO $$
BEGIN
  ASSERT (SELECT invite_email FROM deck_shares
           WHERE id = 'da000000-0000-0000-0000-0000000000a0') IS NULL,
    'the deleted user''s email is removed from the inviter''s row (case-insensitively)';
END $$;

-- ═══ 7) reachability and exposure ══════════════════════════════════════════
DO $$
BEGIN
  ASSERT has_function_privilege('authenticated','public.delete_user_account()','EXECUTE'),
    'a signed-in user can delete their own account';
  ASSERT NOT has_function_privilege('anon','public.delete_user_account()','EXECUTE'),
    'anon must not reach it at all';
  -- The retention table holds the emails of people who asked to be forgotten.
  ASSERT NOT has_table_privilege('anon','public.billing_retention','SELECT'),
    'billing_retention is not client-readable';
  ASSERT NOT has_table_privilege('authenticated','public.billing_retention','SELECT'),
    'billing_retention is not client-readable';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_retention'::regclass),
    'billing_retention keeps RLS on';
  ASSERT (SELECT count(*) FROM pg_policies
           WHERE schemaname='public' AND tablename='billing_retention') = 0,
    'zero policies is the mechanism, not an oversight';
  -- The purge is not something a customer can trigger.
  ASSERT NOT has_function_privilege('authenticated','public.purge_expired_billing_retention(integer)','EXECUTE'),
    'the purge is admin/service_role only';
END $$;

-- ═══ 8) an unauthenticated call refuses ════════════════════════════════════
-- The failure signal deliberately uses a code the handler does NOT catch.
-- `RAISE EXCEPTION 'msg'` defaults to SQLSTATE P0001 — the very code this block is
-- testing for — so signalling failure that way makes the assertion unfailable. A
-- mutation that deleted the function's auth guard passed this test until the signal
-- was moved to its own code.
DO $$
BEGIN
  BEGIN
    PERFORM public.delete_user_account();
    RAISE EXCEPTION 'delete_user_account ran with no auth.uid()' USING errcode = 'P9999';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    NULL; -- expected: 'Authentication required'
  END;
END $$;

-- ═══ 9) retention ends ═════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','da000000-0000-0000-0000-0000000000d2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.purge_expired_billing_retention(5);
    RAISE EXCEPTION 'a plain user purged the retention table';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL; -- expected
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','da000000-0000-0000-0000-0000000000a9',false);
DO $$
DECLARE n integer;
BEGIN
  -- Nothing is 5 years old yet, so an honest purge removes nothing.
  n := public.purge_expired_billing_retention(5);
  ASSERT n = 0, format('a fresh record is not purged, removed %s', n);
  ASSERT (SELECT count(*) FROM billing_retention
           WHERE deleted_user_id = 'da000000-0000-0000-0000-0000000000d1') = 3,
    'the records are still there';

  -- Age them past the window and the purge takes them.
  UPDATE billing_retention SET occurred_at = now() - interval '6 years'
   WHERE deleted_user_id = 'da000000-0000-0000-0000-0000000000d1';
  n := public.purge_expired_billing_retention(5);
  ASSERT n = 3, format('expired records are purged, removed %s', n);

  -- A nonsensical window is refused rather than silently deleting everything.
  BEGIN
    PERFORM public.purge_expired_billing_retention(0);
    RAISE EXCEPTION 'a zero-year retention window was accepted';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    NULL; -- expected
  END;
END $$;

ROLLBACK;

\echo 'account_deletion_test: PASS'
