-- ============================================================================
-- goal_workload_test.sql — goal progress reads the LEARNER's schedule, and reports
-- the work still owed (mig 182).
--
-- WHY THIS EXISTS. Migration 181 counted from `cards.interval_days` /
-- `cards.last_reviewed_at`. Those columns belong to whoever owns the deck. On a
-- subscribed or official deck the learner's schedule lives in `user_card_progress`,
-- so 181 reported the PUBLISHER's state — and official cards carry
-- interval_days = 0 / last_reviewed_at = NULL for everyone. A learner could study an
-- official deck for a month and the progress panel would still say "not started",
-- while the planner (fixed in #389) already knew otherwise. Two numbers on one
-- screen, disagreeing.
--
-- The first assertion below is the one that matters: it fails against 181 and passes
-- against 182. Everything else guards the arithmetic that a schedule will be built on.
--
-- Runs in a txn and ROLLBACKs. Connection role is superuser, so role behaviour is
-- simulated with request.jwt claims.
-- ============================================================================
\set ON_ERROR_STOP on
\set learner '''ba000000-0000-0000-0000-0000000000e1'''
\set pub     '''ba000000-0000-0000-0000-0000000000e2'''
\set NOW     '''2026-08-03T00:00:00Z'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES (:learner,'learner@example.test'), (:pub,'pub@example.test');
INSERT INTO profiles (id, role) VALUES (:learner,'user'), (:pub,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

INSERT INTO card_templates (id, user_id, name, fields)
  VALUES ('ba000000-0000-0000-0000-0000000000c1', :pub, 'T', '[]'::jsonb);

-- A deck the learner does NOT own — the official/subscribed shape. Its cards carry the
-- publisher's schedule: never reviewed, interval 0. That is true of 376k production rows.
INSERT INTO decks (id, user_id, name) VALUES ('ba000000-0000-0000-0000-0000000000d1', :pub, 'Official');
INSERT INTO cards (id, deck_id, user_id, template_id, field_values, interval_days, last_reviewed_at, next_review_at)
VALUES
  ('ba000000-0000-0000-0000-00000000ca01','ba000000-0000-0000-0000-0000000000d1', :pub, 'ba000000-0000-0000-0000-0000000000c1','{}'::jsonb, 0, NULL, NULL),
  ('ba000000-0000-0000-0000-00000000ca02','ba000000-0000-0000-0000-0000000000d1', :pub, 'ba000000-0000-0000-0000-0000000000c1','{}'::jsonb, 0, NULL, NULL),
  ('ba000000-0000-0000-0000-00000000ca03','ba000000-0000-0000-0000-0000000000d1', :pub, 'ba000000-0000-0000-0000-0000000000c1','{}'::jsonb, 0, NULL, NULL);

-- The learner's OWN schedule for two of those three cards.
--   ca01: reviewed 2 days ago on a 10-day interval, next due in 8 days  → known, not due
--   ca02: reviewed 30 days ago on a 5-day interval, was due 25 days ago → not known, overdue
--   ca03: no progress row at all                                        → unseen (intake)
INSERT INTO user_card_progress (user_id, card_id, deck_id, interval_days, last_reviewed_at, next_review_at, srs_status)
VALUES
  (:learner,'ba000000-0000-0000-0000-00000000ca01','ba000000-0000-0000-0000-0000000000d1', 10, :NOW::timestamptz - INTERVAL '2 days',  :NOW::timestamptz + INTERVAL '8 days',  'review'),
  (:learner,'ba000000-0000-0000-0000-00000000ca02','ba000000-0000-0000-0000-0000000000d1',  5, :NOW::timestamptz - INTERVAL '30 days', :NOW::timestamptz - INTERVAL '25 days', 'review');

INSERT INTO learning_goals (id, user_id, domain_id, title, daily_minutes)
  VALUES ('ba000000-0000-0000-0000-0000000000f1', :learner, 'general', 'G', 20);
INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES
  ('ba000000-0000-0000-0000-0000000000f1','ba000000-0000-0000-0000-0000000000d1');

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','ba000000-0000-0000-0000-0000000000e1',false);

-- ═══ 1) THE DEFECT: an official deck must not read as untouched ════════════
DO $$
DECLARE k jsonb;
BEGIN
  k := public.get_goal_knowledge('ba000000-0000-0000-0000-0000000000f1', '2026-08-03T00:00:00Z');

  ASSERT (k->>'total')::int = 3, format('all three cards counted, got %s', k->>'total');

  -- Against mig 181 this is 3: every official card looks never-reviewed because the
  -- PUBLISHER never reviewed them. The learner has studied two.
  ASSERT (k->>'unseen')::int = 1,
    format('only the card with no progress row is unseen, got %s — this is the publisher-column defect', k->>'unseen');

  ASSERT (k->>'known')::int = 1,
    format('the card reviewed 2 days into a 10-day interval is still known, got %s', k->>'known');
  ASSERT (k->>'unknown')::int = 1,
    format('the card 25 days past due is no longer known, got %s', k->>'unknown');
END $$;

-- ═══ 2) the work still owed ════════════════════════════════════════════════
DO $$
DECLARE k jsonb;
BEGIN
  k := public.get_goal_knowledge('ba000000-0000-0000-0000-0000000000f1', '2026-08-03T00:00:00Z');

  -- Only the card whose due date has passed. NOT the unseen one: a never-started card
  -- is intake, gated by the daily new-card rate, not a review that is owed. Counting it
  -- here would make "reviews I owe" include the entire unstarted deck.
  ASSERT (k->>'due_now')::int = 1, format('one review is owed, got %s', k->>'due_now');
  ASSERT (k->>'overdue')::int = 1, format('and it is late, got %s', k->>'overdue');

  -- The scheduler's name for the same count the progress bar calls `unseen`. Both are
  -- returned so neither caller has to learn the other's vocabulary.
  ASSERT (k->>'new_remaining')::int = (k->>'unseen')::int,
    'new_remaining and unseen are the same number';
END $$;

-- ═══ 3) an OWNED deck still reads from the card, as before ═════════════════
-- The fix must not invert the rule: when the learner owns the deck there is no
-- progress row, and the card's own columns are the learner's schedule.
INSERT INTO decks (id, user_id, name) VALUES ('ba000000-0000-0000-0000-0000000000d2', :learner, 'Mine');
INSERT INTO cards (id, deck_id, user_id, template_id, field_values, interval_days, last_reviewed_at, next_review_at)
VALUES ('ba000000-0000-0000-0000-00000000cb01','ba000000-0000-0000-0000-0000000000d2', :learner,
        'ba000000-0000-0000-0000-0000000000c1','{}'::jsonb, 10, :NOW::timestamptz - INTERVAL '1 day', :NOW::timestamptz + INTERVAL '9 days');
INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES
  ('ba000000-0000-0000-0000-0000000000f1','ba000000-0000-0000-0000-0000000000d2');

DO $$
DECLARE k jsonb;
BEGIN
  k := public.get_goal_knowledge('ba000000-0000-0000-0000-0000000000f1', '2026-08-03T00:00:00Z');
  ASSERT (k->>'total')::int = 4, format('both decks counted, got %s', k->>'total');
  ASSERT (k->>'known')::int = 2,
    format('the owned card reads from cards.* and is known, got %s', k->>'known');
  ASSERT (k->>'unseen')::int = 1, format('unseen unchanged, got %s', k->>'unseen');
END $$;

-- ═══ 4) another learner's progress must not leak in ════════════════════════
-- The join is on user_id as well as card_id; without that, one learner's schedule
-- would be reported as another's.
INSERT INTO user_card_progress (user_id, card_id, deck_id, interval_days, last_reviewed_at, next_review_at, srs_status)
VALUES (:pub,'ba000000-0000-0000-0000-00000000ca03','ba000000-0000-0000-0000-0000000000d1', 99, :NOW::timestamptz, :NOW::timestamptz + INTERVAL '99 days','review');

DO $$
DECLARE k jsonb;
BEGIN
  k := public.get_goal_knowledge('ba000000-0000-0000-0000-0000000000f1', '2026-08-03T00:00:00Z');
  ASSERT (k->>'unseen')::int = 1,
    format('the OTHER user''s progress row must not make ca03 look studied, got unseen=%s', k->>'unseen');
END $$;

-- ═══ 5) authorization ══════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub','ba000000-0000-0000-0000-0000000000e2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.get_goal_knowledge('ba000000-0000-0000-0000-0000000000f1', '2026-08-03T00:00:00Z');
    RAISE EXCEPTION 'another user read this goal' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL; -- expected
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT has_function_privilege('authenticated','public.get_goal_knowledge(uuid,timestamptz,numeric)','EXECUTE'),
    'a signed-in learner can read their own goal';
  ASSERT NOT has_function_privilege('anon','public.get_goal_knowledge(uuid,timestamptz,numeric)','EXECUTE'),
    'anon cannot';
END $$;

ROLLBACK;

\echo 'goal_workload_test: PASS'
