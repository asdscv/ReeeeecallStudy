-- Migration 211, and the invariant that stops the two cards on the plan screen disagreeing.
--
-- The report: "복습이 12장 밀렸어요" sat directly above "오늘 이 덱들에서 복습할 카드가 없습니다",
-- and both were computed from the same rows at the same instant. They used different
-- predicates. `known` requires `interval_days > 0`, so every card in a 1- or 10-minute
-- learning step fell into the `unknown` remainder, and the client rendered that remainder as
-- 밀림. Meanwhile the planner asks `next_review_at <= now`, which those same cards fail — they
-- come back in minutes. Twelve cards were "overdue" and "not due" simultaneously.
--
-- What is pinned here:
--
--   1) `overdue ⊆ due_now`. This is THE invariant. The planner's candidate filter is
--      `next_review_at <= now`, which is exactly `due_now`'s predicate, so any goal reporting
--      a backlog necessarily has something for the planner to offer. Nothing guarded it
--      before, and the client had been reading a bucket that satisfies neither.
--   2) A card answered seconds ago is NOT overdue, however the buckets fall.
--   3) `next_due_at` is the soonest FUTURE review, so an empty day can say when the learner
--      is back rather than reading as a failure.
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('a7000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO card_templates (id, user_id, name) VALUES
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Due template');
INSERT INTO decks (id, user_id, name) VALUES
  ('a7200000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Due deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, created_at)
SELECT ('a730000' || n || '-0000-4000-8000-000000000001')::uuid,
       'a7200000-0000-4000-8000-000000000001',
       'a7000000-0000-4000-8000-000000000001',
       'a7100000-0000-4000-8000-000000000001', n, now() - interval '30 days'
  FROM generate_series(1, 5) AS n;
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_goal uuid;
  v_k    jsonb;
BEGIN
  v_goal := (create_learning_goal('language', 'Due goal', 20)->>'goal_id')::uuid;
  PERFORM set_learning_goal_decks(v_goal, jsonb_build_array(
    jsonb_build_object('deck_id', 'a7200000-0000-4000-8000-000000000001', 'importance', 0.5)));

  -- ── The reported state, exactly ───────────────────────────────────────────
  -- Two cards answered moments ago and sitting in a learning step: interval 0, back in
  -- minutes. Nothing is late. Nothing is due. The screen used to call these 밀림.
  UPDATE cards SET interval_days = 0,
                   last_reviewed_at = now() - interval '90 seconds',
                   next_review_at   = now() + interval '9 minutes',
                   srs_status = 'learning'
   WHERE id IN ('a7300001-0000-4000-8000-000000000001',
                'a7300002-0000-4000-8000-000000000001');
  -- Three healthy review cards, comfortably inside their window.
  UPDATE cards SET interval_days = 10,
                   last_reviewed_at = now() - interval '1 day',
                   next_review_at   = now() + interval '9 days',
                   srs_status = 'review'
   WHERE id IN ('a7300003-0000-4000-8000-000000000001',
                'a7300004-0000-4000-8000-000000000001',
                'a7300005-0000-4000-8000-000000000001');

  v_k := get_goal_knowledge(v_goal, now(), 1.0);

  -- The bucket the screen used to render as 밀림 really does hold them...
  IF (v_k->>'unknown')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected the two learning-step cards in `unknown`, got % (%)',
      v_k->>'unknown', v_k;
  END IF;
  -- ...and the honest number says nobody is behind.
  IF (v_k->>'overdue')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: a card answered 90 seconds ago is reported as % overdue',
      v_k->>'overdue';
  END IF;
  IF (v_k->>'due_now')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: nothing is due, but due_now is %', v_k->>'due_now';
  END IF;

  -- ── 211: the empty day can say WHEN ──────────────────────────────────────
  IF v_k->>'next_due_at' IS NULL THEN
    RAISE EXCEPTION 'FAIL: next_due_at is null while five cards are scheduled (%)', v_k;
  END IF;
  -- The SOONEST one still ahead — the learning step at +9 minutes, not the review at +9 days.
  IF (v_k->>'next_due_at')::timestamptz > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'FAIL: next_due_at is % — it skipped the card returning in minutes',
      v_k->>'next_due_at';
  END IF;

  -- ── THE INVARIANT: overdue implies the planner has work ───────────────────
  -- Late by more than a day. `overdue` must be a SUBSET of `due_now`, because `due_now` is
  -- the planner's own filter — otherwise the screen can claim a backlog on a day the plan
  -- comes back empty, which is precisely the contradiction that was reported.
  UPDATE cards SET interval_days = 10,
                   last_reviewed_at = now() - interval '20 days',
                   next_review_at   = now() - interval '10 days'
   WHERE id = 'a7300003-0000-4000-8000-000000000001';

  v_k := get_goal_knowledge(v_goal, now(), 1.0);
  IF (v_k->>'overdue')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: a review ten days late is not counted overdue (%)', v_k;
  END IF;
  IF (v_k->>'overdue')::int > (v_k->>'due_now')::int THEN
    RAISE EXCEPTION 'FAIL: overdue % exceeds due_now % — the headline can claim a backlog the planner cannot serve',
      v_k->>'overdue', v_k->>'due_now';
  END IF;

  -- And `next_due_at` still looks FORWARD: the ten-days-late card must not become "next".
  IF (v_k->>'next_due_at')::timestamptz <= now() THEN
    RAISE EXCEPTION 'FAIL: next_due_at points into the past (%)', v_k->>'next_due_at';
  END IF;

  -- ── Nothing scheduled at all is its own answer ───────────────────────────
  -- The one case that is genuinely bad news. It must be distinguishable from "done for now",
  -- or the screen cannot tell a learner who needs new cards from one who needs to wait.
  UPDATE cards SET next_review_at = NULL, last_reviewed_at = NULL, interval_days = 0
   WHERE deck_id = 'a7200000-0000-4000-8000-000000000001';

  v_k := get_goal_knowledge(v_goal, now(), 1.0);
  IF v_k->>'next_due_at' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: next_due_at is % with nothing scheduled', v_k->>'next_due_at';
  END IF;

  RAISE NOTICE 'goal_knowledge_next_due_test: all assertions passed';
END;
$$;

ROLLBACK;
