-- get_goal_knowledge (migration 181) — the number every learning surface reports.
--
-- The rule it applies is defined in TypeScript, not here: the caller collapses the forgetting
-- curve into `p_stability_multiplier`, and this function only compares dates. So the cases below
-- fix the CONTRACT — ownership, the unseen/known/unknown split, and the fact that the multiplier
-- actually moves the answer — rather than re-asserting the curve, which would recreate the split
-- between SQL and TypeScript that the criterion kernel exists to end.
--
-- k(0.9) = 1 exactly, so at the default the rule reads as "not overdue yet". That equality is
-- pinned on the TypeScript side (learning-knowledge.test.ts); here it is simply assumed.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_owner   uuid := 'a1000000-0000-4000-8000-000000000001';
  v_other   uuid := 'a2000000-0000-4000-8000-000000000002';
  v_deck    uuid;
  v_tmpl    uuid;
  v_goal    uuid;
  v_now     timestamptz := now();
  r         jsonb;
BEGIN
  INSERT INTO card_templates (user_id, name, fields)
    VALUES (v_owner, 'T', '[{"key":"front","name":"Front","type":"text"}]'::jsonb)
    RETURNING id INTO v_tmpl;
  INSERT INTO decks (user_id, name, default_template_id)
    VALUES (v_owner, 'Knowledge deck', v_tmpl) RETURNING id INTO v_deck;

  -- Four cards, one per case the function has to tell apart.
  INSERT INTO cards (deck_id, user_id, template_id, field_values, srs_status, interval_days, last_reviewed_at)
  VALUES
    -- reviewed yesterday on a 30-day interval: comfortably inside it
    (v_deck, v_owner, v_tmpl, '{"front":"known"}'::jsonb,   'review',  30, v_now - INTERVAL '1 day'),
    -- reviewed 40 days ago on a 10-day interval: long overdue
    (v_deck, v_owner, v_tmpl, '{"front":"lapsed"}'::jsonb,  'review',  10, v_now - INTERVAL '40 days'),
    -- never reviewed
    (v_deck, v_owner, v_tmpl, '{"front":"new"}'::jsonb,     'new',      0, NULL),
    -- has a last_reviewed_at but no usable interval: still no evidence to judge on
    (v_deck, v_owner, v_tmpl, '{"front":"nointerval"}'::jsonb, 'learning', 0, v_now - INTERVAL '2 days');

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_owner, 'general', 'Knowledge goal', 20) RETURNING id INTO v_goal;
  INSERT INTO learning_goal_decks (goal_id, deck_id, importance) VALUES (v_goal, v_deck, 0.5);

  -- ── the default rule ──────────────────────────────────────────────────────
  r := get_goal_knowledge(v_goal, v_now, 1.0);
  ASSERT (r->>'total')::int = 4,  format('total: %s', r);
  -- A card with no review history and a card with no interval are BOTH unseen: "no evidence"
  -- is not "will have forgotten", and counting them as unknown would let a fresh deck report a
  -- confident 0%.
  ASSERT (r->>'unseen')::int = 2, format('unseen: %s', r);
  ASSERT (r->>'known')::int = 1,  format('known: %s', r);
  ASSERT (r->>'unknown')::int = 1, format('unknown: %s', r);
  ASSERT (r->>'known')::int + (r->>'unknown')::int + (r->>'unseen')::int = (r->>'total')::int,
    format('buckets do not sum to total: %s', r);

  -- ── judged at a future date: the 30-day card decays out of range ──────────
  r := get_goal_knowledge(v_goal, v_now + INTERVAL '60 days', 1.0);
  ASSERT (r->>'known')::int = 0, format('nothing should survive 60 days here: %s', r);
  ASSERT (r->>'unseen')::int = 2, format('unseen must not change with the date: %s', r);

  -- ── the multiplier is what makes the criterion pluggable ──────────────────
  -- A laxer retention target tolerates more elapsed time, so the overdue card comes back.
  r := get_goal_knowledge(v_goal, v_now, 5.0);
  ASSERT (r->>'known')::int = 2, format('a laxer target should recover the lapsed card: %s', r);
  -- A stricter one drops the recently-reviewed card.
  r := get_goal_knowledge(v_goal, v_now, 0.01);
  ASSERT (r->>'known')::int = 0, format('a strict target should keep nothing: %s', r);

  -- ── refuses inputs it cannot answer honestly ──────────────────────────────
  BEGIN
    PERFORM get_goal_knowledge(v_goal, v_now, 0);
    RAISE EXCEPTION 'expected rejection of a non-positive multiplier';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  BEGIN
    PERFORM get_goal_knowledge(v_goal, NULL, 1.0);
    RAISE EXCEPTION 'expected rejection of a null moment';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  -- ── ownership, because SECURITY DEFINER bypasses RLS ──────────────────────
  -- Reading another learner's progress would be an IDOR of the shape migrations 098/099 closed.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, false);
  BEGIN
    PERFORM get_goal_knowledge(v_goal, v_now, 1.0);
    RAISE EXCEPTION 'expected another user to be refused';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, false);

  BEGIN
    PERFORM get_goal_knowledge('00000000-0000-4000-8000-00000000dead'::uuid, v_now, 1.0);
    RAISE EXCEPTION 'expected a missing goal to be reported, not counted as empty';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  RAISE NOTICE 'goal_knowledge_test: all assertions passed';
END $$;

ROLLBACK;
