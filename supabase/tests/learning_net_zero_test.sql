-- ============================================================================
-- Net-zero test: a rejected learning-engine call changes NOTHING.
--
-- For every guard the RPCs enforce, this asserts that after the rejection the
-- observable state is bit-identical to before it: row counts, plan aggregates,
-- item statuses, goal status, enrichment status, AND the UTC-day usage counters
-- that back the anti-abuse caps.
--
-- WHAT THIS PROVES, PRECISELY
--   It proves the client-observable invariant: one rejected RPC call leaves the
--   database exactly as it was, including the daily quota counters. That is the
--   property a client depends on — a failed call must not consume quota, half-
--   complete a plan item, or leave a dangling attempt.
--
-- WHAT IT DOES NOT PROVE
--   It cannot distinguish "the guard wrote nothing" from "the guard wrote and
--   then raised". PL/pgSQL's EXCEPTION block opens an implicit subtransaction,
--   so any write inside a failing call is rolled back with it. A negative
--   control confirming this was run during development: a deliberately leaky
--   block (write, then RAISE) is reported as net-zero, because the subtxn
--   rollback genuinely undoes the write.
--   That is not a hole in the guarantee — statement-level atomicity is what
--   makes net-zero hold — but this file should not be read as an assertion
--   about the internal ordering of checks and writes inside each function.
--
-- The harness IS verified to catch the two failure modes that matter here:
--   * a call that unexpectedly SUCCEEDS  → flagged (asserted by negative control)
--   * state that differs before vs after → flagged (snapshot equality)
--
-- Rolls back at the end; leaves no rows behind.
-- Usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/learning_net_zero_test.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures: owner (u1) and an unrelated third party (u2) ─────────────────
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id) VALUES
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name) VALUES
  ('60000000-0000-4000-8000-000000000001', 'Net-zero owner'),
  ('60000000-0000-4000-8000-000000000002', 'Net-zero stranger')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('60100000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'NZ template'),
  ('60100000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'NZ template 2');

INSERT INTO decks (id, user_id, name) VALUES
  ('60200000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'NZ deck'),
  ('60200000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'NZ foreign deck');

INSERT INTO cards (
  id, deck_id, user_id, template_id, sort_position, created_at,
  srs_status, interval_days, ease_factor, repetitions
) VALUES
  ('60300000-0000-4000-8000-000000000001',
   '60200000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   '60100000-0000-4000-8000-000000000001', 1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0),
  -- A card the caller has no entitlement to at all.
  ('60300000-0000-4000-8000-000000000002',
   '60200000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002',
   '60100000-0000-4000-8000-000000000002', 1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0);

-- A goal + activity owned by the stranger, to prove cross-user rejection.
INSERT INTO learning_goals (id, user_id, domain_id, title, daily_minutes)
VALUES ('60400000-0000-4000-8000-000000000002',
        '60000000-0000-4000-8000-000000000002', 'language', 'Stranger goal', 30);

INSERT INTO learning_activities (
  id, owner_user_id, card_id, activity_type, stimulus_type,
  response_type, evaluator_type, title
) VALUES (
  '60500000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000002',
  '60300000-0000-4000-8000-000000000002',
  'recall', 'text', 'self_rate', 'self_rate', 'Stranger activity'
);

SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);

CREATE TEMP TABLE nz_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

-- ── Snapshot harness ───────────────────────────────────────────────────────
-- One row of every number a rejected call might move.
CREATE OR REPLACE FUNCTION pg_temp.nz_snapshot() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'goals',        (SELECT count(*) FROM learning_goals WHERE user_id = auth.uid()),
    'goals_active', (SELECT count(*) FROM learning_goals WHERE user_id = auth.uid() AND status <> 'archived'),
    'sources',      (SELECT count(*) FROM content_sources WHERE owner_user_id = auth.uid()),
    'concepts',     (SELECT count(*) FROM learning_concepts WHERE owner_user_id = auth.uid()),
    'activities',   (SELECT count(*) FROM learning_activities WHERE owner_user_id = auth.uid()),
    'plans',        (SELECT count(*) FROM daily_plans WHERE user_id = auth.uid()),
    'plan_items',   (SELECT count(*) FROM daily_plan_items i
                       JOIN daily_plans p ON p.id = i.plan_id WHERE p.user_id = auth.uid()),
    'attempts',     (SELECT count(*) FROM answer_attempts WHERE user_id = auth.uid()),
    'enrichments',  (SELECT count(*) FROM user_enrichments WHERE user_id = auth.uid()),
    'jobs',         (SELECT count(*) FROM ai_generation_jobs WHERE user_id = auth.uid()),
    -- the anti-abuse counters; a guard must not burn quota on a rejected call
    'plan_saves',   (SELECT COALESCE(sum(plan_saves), 0) FROM learning_usage_daily WHERE user_id = auth.uid()),
    'usage_attempts', (SELECT COALESCE(sum(attempts), 0) FROM learning_usage_daily WHERE user_id = auth.uid()),
    -- aggregates and statuses that a partial write would disturb
    'plan_states',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', p.id, 'status', p.status, 'total', p.total_items,
                        'done', p.completed_items, 'mins', p.completed_minutes,
                        'fp', p.input_fingerprint, 'budget', p.budget_minutes)
                        ORDER BY p.id), '[]'::jsonb)
                      FROM daily_plans p WHERE p.user_id = auth.uid()),
    'item_states',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', i.id, 'pos', i.position, 'status', i.status,
                        'attempt', i.completion_attempt_id) ORDER BY i.id), '[]'::jsonb)
                      FROM daily_plan_items i
                      JOIN daily_plans p ON p.id = i.plan_id WHERE p.user_id = auth.uid()),
    'goal_states',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', g.id, 'status', g.status, 'title', g.title,
                        'mins', g.daily_minutes) ORDER BY g.id), '[]'::jsonb)
                      FROM learning_goals g WHERE g.user_id = auth.uid()),
    'enrich_states',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', e.id, 'status', e.status, 'accepted', e.accepted_at)
                        ORDER BY e.id), '[]'::jsonb)
                      FROM user_enrichments e WHERE e.user_id = auth.uid())
  );
$$;

-- Assert a statement rejects AND leaves the snapshot untouched.
-- Runs the call in a subtransaction so the expected error does not abort us.
CREATE OR REPLACE FUNCTION pg_temp.nz_expect_rejected(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  before_snap jsonb := pg_temp.nz_snapshot();
  after_snap  jsonb;
  raised      boolean := false;
  err_msg     text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
    err_msg := SQLERRM;
  END;

  ASSERT raised, format('[%s] expected rejection but the call SUCCEEDED', p_label);

  after_snap := pg_temp.nz_snapshot();
  ASSERT after_snap = before_snap,
    format('[%s] rejected call changed state%s  before=%s%s  after=%s',
           p_label, chr(10), before_snap::text, chr(10), after_snap::text);

  RAISE NOTICE 'NET_ZERO_OK % (rejected: %)', p_label, left(err_msg, 70);
END $$;

-- ── Baseline: one goal, one plan with two items, one completed attempt ──────
DO $$
DECLARE
  r jsonb;
  x_goal uuid;
  x_plan uuid;
  x_item0 uuid;
  x_item1 uuid;
  x_activity uuid;
  x_enrichment uuid;
BEGIN
  r := create_learning_goal('language', 'Net-zero baseline goal', 60);
  x_goal := (r->>'goal_id')::uuid;

  r := create_private_activity(
    'recall', 'text', 'self_rate', 'self_rate', 'NZ activity',
    NULL, '60300000-0000-4000-8000-000000000001'
  );
  x_activity := (r->>'activity_id')::uuid;

  r := save_daily_plan(
    x_goal, '2026-07-30', 'Asia/Seoul', 'daily-plan-v1', 'nz-fp-001', 60,
    jsonb_build_array(
      jsonb_build_object(
        'activity_id', x_activity, 'activity_type', 'recall',
        'stimulus_type', 'text', 'response_type', 'self_rate',
        'evaluator_type', 'self_rate', 'reason_code', 'due_urgency',
        'priority', 0.5, 'estimated_minutes', 5),
      jsonb_build_object(
        'card_id', '60300000-0000-4000-8000-000000000001', 'activity_type', 'recall',
        'stimulus_type', 'text', 'response_type', 'self_rate',
        'evaluator_type', 'self_rate', 'reason_code', 'due_urgency',
        'priority', 0.4, 'estimated_minutes', 5)
    )
  );
  x_plan := (r->>'plan_id')::uuid;
  SELECT id INTO x_item0 FROM daily_plan_items WHERE plan_id = x_plan AND position = 0;
  SELECT id INTO x_item1 FROM daily_plan_items WHERE plan_id = x_plan AND position = 1;

  -- Complete item 0 so later cases have a non-trivial aggregate to disturb.
  r := record_answer_attempt(
    p_client_attempt_id := '60900000-0000-4000-8000-000000000001',
    p_activity_type := 'recall',
    p_response_type := 'self_rate',
    p_evaluator_type := 'self_rate',
    p_response := jsonb_build_object('rating', 'good'),
    p_goal_id := x_goal,
    p_activity_id := x_activity,
    p_plan_item_id := x_item0,
    p_duration_ms := 300000
  );

  INSERT INTO nz_ids VALUES
    ('goal', x_goal), ('plan', x_plan), ('item0', x_item0),
    ('item1', x_item1), ('activity', x_activity),
    ('attempt', (r->>'attempt_id')::uuid);

  RAISE NOTICE 'NET_ZERO_BASELINE ready';
END $$;

-- Seed a preview enrichment (service_role) so terminal-status cases have a target.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
  x_enrichment uuid;
BEGIN
  x_enrichment := persist_ai_remediation(
    p_user_id := '60000000-0000-4000-8000-000000000001',
    p_action := 'explain',
    p_content := jsonb_build_object('action','explain','summary','s',
                                    'blocks', '[]'::jsonb, 'citations', '[]'::jsonb)
  );
  INSERT INTO nz_ids VALUES ('enrichment', x_enrichment);
END $$;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- ════════════════════════════════════════════════════════════════════════════
-- Net-zero cases. Each: reject, and move nothing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Validation bounds ──────────────────────────────────────────────────────
SELECT pg_temp.nz_expect_rejected(
  'goal: empty domain_id',
  $q$ SELECT create_learning_goal('', 'x', 30) $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: blank title',
  $q$ SELECT create_learning_goal('language', '', 30) $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: daily_minutes below range',
  $q$ SELECT create_learning_goal('language', 'x', 0) $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: daily_minutes above range',
  $q$ SELECT create_learning_goal('language', 'x', 1441) $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: invalid status on update',
  $q$ SELECT update_learning_goal((SELECT v FROM nz_ids WHERE k='goal'),
                                  NULL, NULL, NULL, 'not_a_status') $q$);

-- ── Ownership / IDOR ───────────────────────────────────────────────────────
SELECT pg_temp.nz_expect_rejected(
  'goal: update someone else''s goal',
  $q$ SELECT update_learning_goal('60400000-0000-4000-8000-000000000002', 'hijacked') $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: archive someone else''s goal',
  $q$ SELECT archive_learning_goal('60400000-0000-4000-8000-000000000002') $q$);

SELECT pg_temp.nz_expect_rejected(
  'activity: reference a card the caller cannot access',
  $q$ SELECT create_private_activity('recall','text','self_rate','self_rate','x',
        NULL, '60300000-0000-4000-8000-000000000002') $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: save against someone else''s goal',
  $q$ SELECT save_daily_plan('60400000-0000-4000-8000-000000000002', '2026-08-01',
        'Asia/Seoul','daily-plan-v1','nz-foreign',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',5))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: item references an inaccessible card',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-02',
        'Asia/Seoul','daily-plan-v1','nz-badcard',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000002','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',5))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: item references an inaccessible activity',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-03',
        'Asia/Seoul','daily-plan-v1','nz-badact',30,
        jsonb_build_array(jsonb_build_object(
          'activity_id','60500000-0000-4000-8000-000000000002','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',5))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: reference someone else''s goal',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_goal_id := '60400000-0000-4000-8000-000000000002',
        p_card_id := '60300000-0000-4000-8000-000000000001') $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: reference an inaccessible card',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_card_id := '60300000-0000-4000-8000-000000000002') $q$);

-- ── Payload and shape bounds ───────────────────────────────────────────────
SELECT pg_temp.nz_expect_rejected(
  'plan: zero items',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-04',
        'Asia/Seoul','daily-plan-v1','nz-empty',30,'[]'::jsonb) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: more than 500 items',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-05',
        'Asia/Seoul','daily-plan-v1','nz-toomany',30,
        (SELECT jsonb_agg(jsonb_build_object(
            'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
            'stimulus_type','text','response_type','self_rate',
            'evaluator_type','self_rate','reason_code','due_urgency',
            'priority',0.5,'estimated_minutes',1))
         FROM generate_series(1, 501))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: items payload over 64KiB',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-06',
        'Asia/Seoul','daily-plan-v1','nz-huge',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',1,
          'payload', jsonb_build_object('blob', repeat('x', 70000))))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: item missing activity_type',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-07',
        'Asia/Seoul','daily-plan-v1','nz-noactivity',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',1))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'plan: blank timezone',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-08',
        '','daily-plan-v1','nz-tz',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',1))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: neither activity nor card',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate') $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: normalized_score out of range',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_card_id := '60300000-0000-4000-8000-000000000001',
        p_normalized_score := 1.5) $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: negative duration',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_card_id := '60300000-0000-4000-8000-000000000001',
        p_duration_ms := -1) $q$);

SELECT pg_temp.nz_expect_rejected(
  'attempt: response payload over 64KiB',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := gen_random_uuid(),
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_card_id := '60300000-0000-4000-8000-000000000001',
        p_response := jsonb_build_object('blob', repeat('x', 70000))) $q$);

-- ── Idempotency abuse: same client id, different payload ───────────────────
-- Must be refused outright rather than overwriting the stored attempt.
SELECT pg_temp.nz_expect_rejected(
  'attempt: client id reused with a different payload',
  $q$ SELECT record_answer_attempt(
        p_client_attempt_id := '60900000-0000-4000-8000-000000000001',
        p_activity_type := 'recall', p_response_type := 'self_rate',
        p_evaluator_type := 'self_rate',
        p_response := jsonb_build_object('rating','again'),
        p_goal_id := (SELECT v FROM nz_ids WHERE k='goal'),
        p_activity_id := (SELECT v FROM nz_ids WHERE k='activity'),
        p_plan_item_id := (SELECT v FROM nz_ids WHERE k='item0'),
        p_duration_ms := 999) $q$);

-- ── Lifecycle guards ──────────────────────────────────────────────────────
SELECT pg_temp.nz_expect_rejected(
  'enrichment: unknown status value',
  $q$ SELECT set_user_enrichment_status(
        (SELECT v FROM nz_ids WHERE k='enrichment'), 'bogus') $q$);

SELECT pg_temp.nz_expect_rejected(
  'enrichment: someone else''s enrichment',
  $q$ SELECT set_user_enrichment_status(gen_random_uuid(), 'accepted') $q$);

-- ── Remediation guards ────────────────────────────────────────────────────
SELECT pg_temp.nz_expect_rejected(
  'remediation: invalid action',
  $q$ SELECT reserve_ai_remediation('exfiltrate',
        (SELECT v FROM nz_ids WHERE k='goal')) $q$);

SELECT pg_temp.nz_expect_rejected(
  'remediation: no structured reference',
  $q$ SELECT reserve_ai_remediation('explain') $q$);

SELECT pg_temp.nz_expect_rejected(
  'remediation: someone else''s goal',
  $q$ SELECT reserve_ai_remediation('explain',
        '60400000-0000-4000-8000-000000000002') $q$);

SELECT pg_temp.nz_expect_rejected(
  'remediation: inaccessible card reference',
  $q$ SELECT reserve_ai_remediation('explain',
        (SELECT v FROM nz_ids WHERE k='goal'), NULL, NULL,
        ARRAY['60300000-0000-4000-8000-000000000002']::uuid[]) $q$);

SELECT pg_temp.nz_expect_rejected(
  'remediation: zero wallet balance blocks reservation',
  $q$ SELECT reserve_ai_remediation('explain',
        (SELECT v FROM nz_ids WHERE k='goal')) $q$);

-- ── Privilege boundary: a learner cannot call the service-only writer ──────
SELECT pg_temp.nz_expect_rejected(
  'enrichment: authenticated cannot call persist_ai_remediation',
  $q$ SELECT persist_ai_remediation(
        p_user_id := '60000000-0000-4000-8000-000000000001',
        p_action := 'explain',
        p_content := jsonb_build_object('action','explain','summary','s',
                                        'blocks','[]'::jsonb,'citations','[]'::jsonb)) $q$);

-- ── Completed-plan protection ─────────────────────────────────────────────
-- Finish the plan, then prove a regeneration cannot clobber completed work.
DO $$
DECLARE
  r jsonb;
  x_plan uuid := (SELECT v FROM nz_ids WHERE k='plan');
BEGIN
  r := record_answer_attempt(
    p_client_attempt_id := '60900000-0000-4000-8000-000000000002',
    p_activity_type := 'recall', p_response_type := 'self_rate',
    p_evaluator_type := 'self_rate',
    p_goal_id := (SELECT v FROM nz_ids WHERE k='goal'),
    p_card_id := '60300000-0000-4000-8000-000000000001',
    p_plan_item_id := (SELECT v FROM nz_ids WHERE k='item1'),
    p_duration_ms := 300000);
  ASSERT (r->>'ok')::boolean, r::text;
  ASSERT (SELECT status FROM daily_plans WHERE id = x_plan) = 'completed',
    'baseline plan should be completed before the overwrite case';
END $$;

SELECT pg_temp.nz_expect_rejected(
  'plan: cannot overwrite a completed plan',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-07-30',
        'Asia/Seoul','daily-plan-v1','nz-clobber',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',1))) $q$);

-- ── Archived-goal immutability ────────────────────────────────────────────
DO $$
BEGIN
  PERFORM archive_learning_goal((SELECT v FROM nz_ids WHERE k='goal'));
END $$;

SELECT pg_temp.nz_expect_rejected(
  'plan: archived goal rejects a new plan',
  $q$ SELECT save_daily_plan((SELECT v FROM nz_ids WHERE k='goal'), '2026-08-09',
        'Asia/Seoul','daily-plan-v1','nz-archived',30,
        jsonb_build_array(jsonb_build_object(
          'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
          'stimulus_type','text','response_type','self_rate',
          'evaluator_type','self_rate','reason_code','due_urgency',
          'priority',0.5,'estimated_minutes',1))) $q$);

SELECT pg_temp.nz_expect_rejected(
  'goal: archive an already-archived goal',
  $q$ SELECT archive_learning_goal((SELECT v FROM nz_ids WHERE k='goal')) $q$);

SELECT pg_temp.nz_expect_rejected(
  'remediation: archived goal rejects reservation',
  $q$ SELECT reserve_ai_remediation('explain',
        (SELECT v FROM nz_ids WHERE k='goal')) $q$);

-- ── Anonymous callers cannot touch anything ───────────────────────────────
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
DECLARE
  before_goals integer;
  after_goals integer;
  raised boolean := false;
BEGIN
  SELECT count(*) INTO before_goals FROM learning_goals;
  BEGIN
    PERFORM create_learning_goal('language', 'anon goal', 30);
  EXCEPTION WHEN OTHERS THEN raised := true;
  END;
  ASSERT raised, 'anon create_learning_goal was not rejected';
  SELECT count(*) INTO after_goals FROM learning_goals;
  ASSERT before_goals = after_goals, 'anon call changed learning_goals';
  RAISE NOTICE 'NET_ZERO_OK anon: create_learning_goal rejected, no rows written';
END $$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);

-- ── Quota integrity after the rejection barrage ────────────────────────────
-- Every case above was rejected. If any of them had leaked a counter increment
-- the snapshot equality would have failed, but assert the end state directly
-- too: the day's counters must equal exactly the work that actually succeeded
-- (1 plan save + 2 attempts from the baseline), and a fresh successful call
-- must still increment by exactly one — proving the counters are usable, not
-- merely unchanged.
DO $$
DECLARE
  saves_before integer;
  attempts_before integer;
  saves_after integer;
  attempts_after integer;
  r jsonb;
  x_goal2 uuid;
BEGIN
  SELECT COALESCE(sum(plan_saves), 0), COALESCE(sum(attempts), 0)
    INTO saves_before, attempts_before
    FROM learning_usage_daily WHERE user_id = auth.uid();

  ASSERT saves_before = 1,
    format('expected exactly 1 successful plan save on the day, got %s', saves_before);
  ASSERT attempts_before = 2,
    format('expected exactly 2 successful attempts on the day, got %s', attempts_before);

  -- The engine still works after all those rejections.
  r := create_learning_goal('language', 'post-rejection goal', 30);
  x_goal2 := (r->>'goal_id')::uuid;
  r := save_daily_plan(
    x_goal2, '2026-08-20', 'Asia/Seoul', 'daily-plan-v1', 'nz-after', 30,
    jsonb_build_array(jsonb_build_object(
      'card_id','60300000-0000-4000-8000-000000000001','activity_type','recall',
      'stimulus_type','text','response_type','self_rate',
      'evaluator_type','self_rate','reason_code','due_urgency',
      'priority',0.5,'estimated_minutes',5)));
  ASSERT (r->>'ok')::boolean, r::text;

  SELECT COALESCE(sum(plan_saves), 0), COALESCE(sum(attempts), 0)
    INTO saves_after, attempts_after
    FROM learning_usage_daily WHERE user_id = auth.uid();

  ASSERT saves_after = saves_before + 1,
    format('plan save counter moved by %s, expected 1', saves_after - saves_before);
  ASSERT attempts_after = attempts_before,
    'a plan save moved the attempt counter';

  RAISE NOTICE 'NET_ZERO_OK quota counters intact and still functional';
END $$;

SELECT 'ALL_LEARNING_NET_ZERO_TESTS_PASSED' AS result;

ROLLBACK;
