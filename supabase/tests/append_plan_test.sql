-- ============================================================================
-- append_plan_test.sql — "더 하기" adds to today's plan and destroys nothing
-- (mig 185).
--
-- WHY THIS EXISTS. The only way to add work to a day was `save_daily_plan`, which
-- DELETEs every item and zeroes `completed_items`/`completed_minutes`. A learner who
-- finished half the plan and wanted more would lose the half they did. The first
-- assertion below is that one: progress survives the append. Everything else guards
-- the ways an append could quietly corrupt the plan it is adding to — duplicate
-- cards, colliding positions, a drifted `total_items`, an unmetered write.
--
-- Runs in a txn and ROLLBACKs. Connection role is superuser, so role behaviour is
-- simulated with request.jwt claims.
--
-- NOTE ON FAILURE SIGNALS: a bare `RAISE EXCEPTION 'msg'` is SQLSTATE P0001, which is
-- also what these functions raise for "Authentication required" — a handler meant to
-- catch the function would swallow the test's own failure and the assertion could
-- never fail. Every deliberate failure below uses P9999.
-- ============================================================================
\set ON_ERROR_STOP on
\set learner '''ca000000-0000-0000-0000-0000000000e1'''
\set other   '''ca000000-0000-0000-0000-0000000000e2'''
\set goal    '''ca000000-0000-0000-0000-0000000000f1'''
\set deck    '''ca000000-0000-0000-0000-0000000000d1'''
\set DAY     '''2026-08-03'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES (:learner,'appender@example.test'), (:other,'other@example.test');
INSERT INTO profiles (id, role) VALUES (:learner,'user'), (:other,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

INSERT INTO card_templates (id, user_id, name, fields)
  VALUES ('ca000000-0000-0000-0000-0000000000c1', :learner, 'T', '[]'::jsonb);
INSERT INTO decks (id, user_id, name) VALUES (:deck, :learner, 'Mine');

-- Six cards: ca01..ca06.
INSERT INTO cards (id, deck_id, user_id, template_id, field_values)
SELECT
  ('ca000000-0000-0000-0000-00000000ca0' || n)::uuid,
  :deck, :learner, 'ca000000-0000-0000-0000-0000000000c1', '{}'::jsonb
FROM generate_series(1, 6) AS n;

INSERT INTO learning_goals (id, user_id, domain_id, title, daily_minutes)
  VALUES (:goal, :learner, 'general', 'G', 20);
INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES (:goal, :deck);

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-0000000000e1',false);

/* One plan item, as the client sends it. */
CREATE OR REPLACE FUNCTION pg_temp.item(p_card text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'card_id', 'ca000000-0000-0000-0000-00000000ca0' || p_card,
    'activity_type', 'flashcard_recall',
    'stimulus_type', 'text',
    'response_type', 'self_rating',
    'evaluator_type', 'self_report',
    'reason_code', 'extra',
    'priority', 0.5,
    'estimated_minutes', 0.5
  );
$$;

-- A plan with two items, one of them already done.
SELECT public.save_daily_plan(
  :goal, :DAY::date, 'Asia/Seoul', 'daily-plan-v1', 'fnv1a32:aaaa', 20,
  jsonb_build_array(pg_temp.item('1'), pg_temp.item('2'))
);

UPDATE daily_plan_items SET status = 'completed'
 WHERE plan_id = (SELECT id FROM daily_plans WHERE goal_id = :goal AND plan_date = :DAY::date)
   AND position = 0;
UPDATE daily_plans SET completed_items = 1, completed_minutes = 7, status = 'active'
 WHERE goal_id = :goal AND plan_date = :DAY::date;

-- ═══ 1) THE DEFECT: appending must not erase the work already done ══════════
DO $$
DECLARE r jsonb; p record;
BEGIN
  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('3'), pg_temp.item('4')));

  ASSERT (r->>'appended')::int = 2, format('both items appended, got %s', r->>'appended');

  SELECT * INTO p FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  -- This is what `save_daily_plan` would have destroyed. The whole point of 185.
  ASSERT p.completed_items = 1, format('the finished item stays finished, got %s', p.completed_items);
  ASSERT p.completed_minutes = 7, format('and its minutes stay counted, got %s', p.completed_minutes);
  ASSERT p.total_items = 4, format('total grew by exactly the appended count, got %s', p.total_items);

  ASSERT (SELECT count(*) FROM daily_plan_items WHERE plan_id = p.id) = 4,
    'four rows exist';
  ASSERT (SELECT count(*) FROM daily_plan_items WHERE plan_id = p.id AND status = 'completed') = 1,
    'the completed item was not reset to pending';

  -- `budget_minutes` records what the learner committed to. Raising it would make
  -- "did I meet my budget today" answer yes to a day that deliberately went over.
  ASSERT p.budget_minutes = 20, format('budget untouched, got %s', p.budget_minutes);
END $$;

-- ═══ 2) positions continue, they do not collide or restart ═════════════════
-- idx_daily_plan_items_plan_position is UNIQUE on (plan_id, position): restarting at
-- 0 would raise, and re-using a position would reorder the learner's list under them.
DO $$
DECLARE p_id uuid;
BEGIN
  SELECT id INTO p_id FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  ASSERT (SELECT array_agg(position ORDER BY position) FROM daily_plan_items WHERE plan_id = p_id)
         = ARRAY[0,1,2,3],
    'positions are 0..3 with no gap and no repeat';

  -- The appended work sits AFTER what was already there.
  ASSERT (SELECT count(*) FROM daily_plan_items
           WHERE plan_id = p_id AND position >= 2
             AND card_id IN ('ca000000-0000-0000-0000-00000000ca03',
                             'ca000000-0000-0000-0000-00000000ca04')) = 2,
    'appended items come last';
END $$;

-- ═══ 3) a card already in the plan is skipped, not duplicated ══════════════
-- The client filters these out, but its list can be stale — another device, another
-- tab. Failing the call would turn a race into an error; a duplicate would show the
-- same card twice and count it twice.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('1'), pg_temp.item('5')));

  ASSERT (r->>'appended')::int = 1, format('only the new card was added, got %s', r->>'appended');
  ASSERT (r->>'skipped')::int = 1, format('and the duplicate was reported, got %s', r->>'skipped');
  ASSERT (r->>'total_items')::int = 5, format('total is 5, got %s', r->>'total_items');
  -- And the COLUMN, not just the returned count. `total_items` must grow by what was
  -- actually inserted, not by what was offered — a plan claiming more items than it has
  -- can never reach `completed_items >= total_items`, so it never completes.
  ASSERT (SELECT total_items FROM daily_plans WHERE id = (r->>'plan_id')::uuid) = 5,
    format('daily_plans.total_items counts appended, not offered, got %s',
           (SELECT total_items FROM daily_plans WHERE id = (r->>'plan_id')::uuid));

  ASSERT (SELECT count(*) FROM daily_plan_items
           WHERE plan_id = (r->>'plan_id')::uuid
             AND card_id = 'ca000000-0000-0000-0000-00000000ca01') = 1,
    'card 1 appears exactly once';
END $$;

-- ═══ 4) a duplicate WITHIN one call is caught too ══════════════════════════
-- Each insert is visible to the next iteration, which is what makes this work.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('6'), pg_temp.item('6')));

  ASSERT (r->>'appended')::int = 1, format('the same card twice in one payload adds once, got %s', r->>'appended');
  ASSERT (r->>'skipped')::int = 1, format('the second is skipped, got %s', r->>'skipped');
END $$;

-- ═══ 5) an all-duplicate call changes nothing ══════════════════════════════
-- It must not corrupt `total_items` by adding zero rows and counting them anyway.
DO $$
DECLARE r jsonb; before_total int;
BEGIN
  SELECT total_items INTO before_total FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('1')));

  ASSERT (r->>'appended')::int = 0 AND (r->>'skipped')::int = 1, 'nothing added';
  ASSERT (SELECT total_items FROM daily_plans
           WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03')
         = before_total,
    'total_items unchanged when nothing was appended';
END $$;

-- ═══ 5b) …and a no-op append does not revive a completed plan ══════════════
-- Adding zero items adds zero work. Flipping the status anyway would tell a learner who
-- finished their day that they have not, and the only way back would be to study
-- something that is not there.
DO $$
DECLARE r jsonb; st text;
BEGIN
  UPDATE daily_plans SET status = 'completed', completed_items = total_items
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('1')));
  ASSERT (r->>'appended')::int = 0, 'nothing was appended';

  SELECT status INTO st FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';
  ASSERT st = 'completed', format('a no-op append leaves the plan completed, got %s', st);
END $$;

-- ═══ 6) a COMPLETED plan is a valid target — this is the point ═════════════
-- `save_daily_plan` refuses one (P0007) because overwriting a finished day destroys
-- it. Appending adds to it, which is exactly what "다 했는데 더 하고 싶다" means.
DO $$
DECLARE r jsonb; p record;
BEGIN
  UPDATE daily_plans SET status = 'completed', completed_items = total_items
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  -- Prove the old tool refuses, so this test states a difference and not a wish.
  BEGIN
    PERFORM public.save_daily_plan(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date, 'Asia/Seoul',
      'daily-plan-v1', 'fnv1a32:bbbb', 20, jsonb_build_array(pg_temp.item('1')));
    RAISE EXCEPTION 'save_daily_plan overwrote a completed plan' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0007' THEN
    NULL; -- expected
  END;

  -- Free a card to append: ca02 is in the plan, so remove it first.
  DELETE FROM daily_plan_items
   WHERE card_id = 'ca000000-0000-0000-0000-00000000ca02'
     AND plan_id = (SELECT id FROM daily_plans
                     WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1'
                       AND plan_date = '2026-08-03');
  UPDATE daily_plans SET total_items = total_items - 1
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  r := public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('2')));
  ASSERT (r->>'appended')::int = 1, 'appending to a completed plan works';

  SELECT * INTO p FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  -- 'active', not 'pending': work HAS been done, and the progress line reads this.
  ASSERT p.status = 'active', format('status returns to active, got %s', p.status);
  ASSERT p.completed_items > 0, 'and the completed count survived';
END $$;

-- ═══ 7) an abandoned plan is not revived by a side door ════════════════════
-- Abandoning is a deliberate end state. Regenerating is the way back, and it says so.
DO $$
BEGIN
  UPDATE daily_plans SET status = 'abandoned'
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';

  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
      jsonb_build_array(pg_temp.item('3')));
    RAISE EXCEPTION 'appended to an abandoned plan' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0007' THEN
    NULL; -- expected
  END;

  UPDATE daily_plans SET status = 'active'
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';
END $$;

-- ═══ 8) there must already be a plan ═══════════════════════════════════════
-- Creating one here would mean inventing a timezone, algorithm version and
-- fingerprint this function has no honest value for — it did not do the planning.
DO $$
BEGIN
  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-04'::date,
      jsonb_build_array(pg_temp.item('3')));
    RAISE EXCEPTION 'appended to a day with no plan' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0003' THEN
    NULL; -- expected
  END;
END $$;

-- ═══ 9) authorization: another user's goal is not appendable ═══════════════
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-0000000000e2',false);
  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
      jsonb_build_array(pg_temp.item('3')));
    RAISE EXCEPTION 'another user appended to this plan' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0003' THEN
    NULL; -- expected
  END;
  PERFORM set_config('request.jwt.claim.sub','ca000000-0000-0000-0000-0000000000e1',false);
END $$;

-- ═══ 9b) an ARCHIVED goal is not appendable ════════════════════════════════
-- This is the case only the goal check catches: the plan lookup is scoped by user_id,
-- so it already rejects another user — but an archived goal still has a plan row, and
-- without this check a goal the learner put away would keep accepting work.
DO $$
BEGIN
  UPDATE learning_goals SET status = 'archived' WHERE id = 'ca000000-0000-0000-0000-0000000000f1';
  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
      jsonb_build_array(pg_temp.item('3')));
    RAISE EXCEPTION 'appended to an archived goal' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0003' THEN
    NULL; -- expected
  END;
  UPDATE learning_goals SET status = 'active' WHERE id = 'ca000000-0000-0000-0000-0000000000f1';
END $$;

-- ═══ 10) the 500-item ceiling counts what is THERE, not what was claimed ═══
-- Counted from the rows rather than from `total_items`, so a drifted aggregate
-- cannot be used to raise the cap.
DO $$
DECLARE p_id uuid; n int; next_pos int;
BEGIN
  SELECT id INTO p_id FROM daily_plans
   WHERE goal_id = 'ca000000-0000-0000-0000-0000000000f1' AND plan_date = '2026-08-03';
  SELECT count(*) INTO n FROM daily_plan_items WHERE plan_id = p_id;
  -- From max(position)+1, NOT from the row count: block 6 deleted an item, so the
  -- positions have a gap and the two numbers differ. Padding from the count would
  -- collide with a row that is still there.
  SELECT COALESCE(max(position), -1) + 1 INTO next_pos
    FROM daily_plan_items WHERE plan_id = p_id;

  -- Pad to 500 rows directly, then lie in the aggregate.
  INSERT INTO daily_plan_items (plan_id, position, card_id, activity_type, stimulus_type,
                                response_type, evaluator_type, reason_code, priority, estimated_minutes)
  SELECT p_id, next_pos + s - 1, NULL, 'flashcard_recall', 'text', 'self_rating', 'self_report', 'pad', 0, 1
    FROM generate_series(1, 500 - n) AS s;
  UPDATE daily_plans SET total_items = 3 WHERE id = p_id;

  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
      jsonb_build_array(pg_temp.item('3')));
    RAISE EXCEPTION 'appended past the 500-item ceiling' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0006' THEN
    NULL; -- expected
  END;
END $$;

-- ═══ 11) it is metered, and a refused call does not charge ═════════════════
-- An append endpoint with no meter is an unmetered write endpoint: the 500-item cap
-- bounds one plan, not the number of calls.
DO $$
DECLARE before_saves int; after_saves int;
BEGIN
  SELECT plan_saves INTO before_saves FROM learning_usage_daily
   WHERE user_id = 'ca000000-0000-0000-0000-0000000000e1'
     AND usage_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  ASSERT before_saves > 1, format('appends have been charging all along, got %s', before_saves);

  -- The call refused in (10) must not have kept its increment.
  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date, '[]'::jsonb);
    RAISE EXCEPTION 'an empty payload was accepted' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    NULL; -- expected
  END;

  SELECT plan_saves INTO after_saves FROM learning_usage_daily
   WHERE user_id = 'ca000000-0000-0000-0000-0000000000e1'
     AND usage_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  ASSERT after_saves = before_saves,
    format('a rejected call charges nothing, %s → %s', before_saves, after_saves);
END $$;

-- ═══ 11b) hitting the cap refuses, and refunds its own increment ══════════
-- The increment is written BEFORE the cap is checked, so a refused call must not leave
-- it behind — otherwise the counter would climb past 50 on calls that did nothing and
-- lock the learner out for the rest of the UTC day.
--
-- What guarantees it is the statement abort, not an explicit decrement: an unhandled
-- RAISE rolls back everything the call did, including the INSERT ... ON CONFLICT above.
-- `save_daily_plan` also writes a manual `plan_saves - 1` there; deleting it changes
-- nothing, which is how it was identified as dead code and left out of 185. This block
-- pins the OUTCOME, so it stays true whichever mechanism provides it.
DO $$
DECLARE v_date date := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
        after_saves int;
BEGIN
  -- Park the counter one below the cap, so the next call is the 50th (allowed) and the
  -- one after is the 51st (refused).
  UPDATE learning_usage_daily SET plan_saves = 49
   WHERE user_id = 'ca000000-0000-0000-0000-0000000000e1' AND usage_date = v_date;

  -- Free two cards so there is real work to append.
  DELETE FROM daily_plan_items
   WHERE card_id IN ('ca000000-0000-0000-0000-00000000ca03','ca000000-0000-0000-0000-00000000ca04');

  PERFORM public.append_daily_plan_items(
    'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
    jsonb_build_array(pg_temp.item('3')));
  ASSERT (SELECT plan_saves FROM learning_usage_daily
           WHERE user_id = 'ca000000-0000-0000-0000-0000000000e1' AND usage_date = v_date) = 50,
    'the 50th write is allowed and charged';

  BEGIN
    PERFORM public.append_daily_plan_items(
      'ca000000-0000-0000-0000-0000000000f1', '2026-08-03'::date,
      jsonb_build_array(pg_temp.item('4')));
    RAISE EXCEPTION 'the 51st write was allowed' USING ERRCODE = 'P9999';
  EXCEPTION WHEN sqlstate 'P0006' THEN
    NULL; -- expected
  END;

  SELECT plan_saves INTO after_saves FROM learning_usage_daily
   WHERE user_id = 'ca000000-0000-0000-0000-0000000000e1' AND usage_date = v_date;
  ASSERT after_saves = 50,
    format('the refused call refunded its increment, got %s', after_saves);
END $$;

-- ═══ 12) grants ════════════════════════════════════════════════════════════
RESET ROLE;
DO $$
BEGIN
  ASSERT has_function_privilege('authenticated','public.append_daily_plan_items(uuid,date,jsonb)','EXECUTE'),
    'a signed-in learner can append';
  ASSERT NOT has_function_privilege('anon','public.append_daily_plan_items(uuid,date,jsonb)','EXECUTE'),
    'anon cannot';
END $$;

ROLLBACK;

\echo 'append_plan_test: PASS'
