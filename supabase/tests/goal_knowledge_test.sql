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
    -- mid-learning-step: studied two days ago, interval 0 because that is what the SRS
    -- writes for a learning step (srs.ts:130/144/168) and for a review just rated "again"
    -- (again_days = 0). Studied, and owed right now.
    (v_deck, v_owner, v_tmpl, '{"front":"nointerval"}'::jsonb, 'learning', 0, v_now - INTERVAL '2 days');

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_owner, 'general', 'Knowledge goal', 20) RETURNING id INTO v_goal;
  INSERT INTO learning_goal_decks (goal_id, deck_id, importance) VALUES (v_goal, v_deck, 0.5);

  -- ── the default rule ──────────────────────────────────────────────────────
  r := get_goal_knowledge(v_goal, v_now, 1.0);
  ASSERT (r->>'total')::int = 4,  format('total: %s', r);
  -- `unseen` is `last_reviewed_at IS NULL` and nothing else (mig 191). This assertion used to
  -- read 2, counting the mid-learning-step card as never studied because its interval is 0 —
  -- the defect 191 removed. A learner reported it as "아직 안 배움 12장" over a goal where every
  -- card had been studied, and the progress bar moved BACKWARDS when they rated a review
  -- "again", since the card left `known` for `unseen`.
  --
  -- "No evidence is not will-have-forgotten" still holds — it is why a never-reviewed card is
  -- kept out of `unknown`. It simply never applied to a card answered two days ago.
  ASSERT (r->>'unseen')::int = 1, format('unseen: %s', r);
  ASSERT (r->>'known')::int = 1,  format('known: %s', r);
  -- The overdue review AND the learning-step card: both are work owed now.
  ASSERT (r->>'unknown')::int = 2, format('unknown: %s', r);
  ASSERT (r->>'known')::int + (r->>'unknown')::int + (r->>'unseen')::int = (r->>'total')::int,
    format('buckets do not sum to total: %s', r);

  -- ── judged at a future date: the 30-day card decays out of range ──────────
  r := get_goal_knowledge(v_goal, v_now + INTERVAL '60 days', 1.0);
  ASSERT (r->>'known')::int = 0, format('nothing should survive 60 days here: %s', r);
  ASSERT (r->>'unseen')::int = 1, format('unseen must not change with the date: %s', r);

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

  -- ── an untouched card in a SUBSCRIBED deck is unseen, not absent ──────────
  -- The resolver's first version chose its own scope and returned only cards the learner already
  -- had a progress row for, so a goal over a subscribed deck under-reported its own total. A
  -- differential run against the pre-resolver function is what caught it (12 where 182 said 14),
  -- and this is that case, pinned.
  DECLARE
    v_pub    uuid := '77770000-0000-4000-8000-000000000007';
    v_ptmpl  uuid;
    v_pdeck  uuid;
    v_goal2  uuid;
    r2       jsonb;
  BEGIN
    INSERT INTO auth.users (id) VALUES (v_pub) ON CONFLICT (id) DO NOTHING;
    INSERT INTO card_templates (user_id, name, fields)
      VALUES (v_pub, 'P', '[{"key":"f","name":"F","type":"text"}]'::jsonb) RETURNING id INTO v_ptmpl;
    INSERT INTO decks (user_id, name, default_template_id)
      VALUES (v_pub, 'Published', v_ptmpl) RETURNING id INTO v_pdeck;
    -- Three cards the publisher has studied to 300 days. The learner owns none of them.
    INSERT INTO cards (deck_id, user_id, template_id, field_values, srs_status, interval_days, last_reviewed_at)
    SELECT v_pdeck, v_pub, v_ptmpl, '{"f":"s"}'::jsonb, 'review', 300, now() - INTERVAL '1 day'
    FROM generate_series(1, 3);
    -- The learner has touched exactly one of them.
    INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status, interval_days, last_reviewed_at)
    SELECT v_owner, c.id, c.deck_id, 'review', 40, now() - INTERVAL '1 day'
    FROM (SELECT id, deck_id FROM cards WHERE deck_id = v_pdeck LIMIT 1) c;

    INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
      VALUES (v_owner, 'general', 'Subscribed goal', 20) RETURNING id INTO v_goal2;
    INSERT INTO learning_goal_decks (goal_id, deck_id, importance) VALUES (v_goal2, v_pdeck, 0.5);

    r2 := get_goal_knowledge(v_goal2, v_now, 1.0);
    ASSERT (r2->>'total')::int = 3,
      format('all three subscribed cards must count, not just the touched one: %s', r2);
    -- Genuinely untouched: no learner row at all, so `last_reviewed_at` is NULL. Unaffected
    -- by 191, which only stopped counting STUDIED cards as unseen.
    ASSERT (r2->>'unseen')::int = 2, format('the two untouched cards must be unseen: %s', r2);
    -- And the one they DID touch is judged on THEIR 40-day interval, not the publisher's 300.
    ASSERT (r2->>'known')::int = 1, format('the touched card should be known: %s', r2);
    r2 := get_goal_knowledge(v_goal2, v_now + INTERVAL '100 days', 1.0);
    ASSERT (r2->>'known')::int = 0,
      format('at +100 days a 40-day interval is gone; reading the publisher''s 300 would keep it: %s', r2);
  END;

  -- ── mastery and the completion stamp (mig 192) ────────────────────────────
  --
  -- A goal could not finish before this: the status value, the transition and the `target`
  -- column all existed and no code ever decided. Under SRS nothing decides itself either.
  r := get_goal_knowledge(v_goal, v_now, 1.0);
  -- Only the 30-day card is mature. The 10-day one is graduated but short of 21, and the
  -- learning-step card has no interval at all.
  ASSERT (r->>'mature')::int = 1, format('mature: %s', r);
  ASSERT (r->>'rung8')::int  = 1, format('the 10-day card sits at rung 8: %s', r);
  ASSERT (r->>'rung1')::int  = 1, format('the learning-step card sits at rung 1: %s', r);

  -- 1 of 4 mature is 25%, far short of 80%.
  ASSERT NOT (complete_goal_if_earned(v_goal)->>'completed')::boolean,
    'a goal at 25% mastery must not be stamped';
  ASSERT (SELECT status FROM learning_goals WHERE id = v_goal) = 'active',
    'a refused stamp must leave the goal active';

  -- Bring every card to a mature interval: 4/4 clears the bar.
  UPDATE cards SET interval_days = 30, last_reviewed_at = v_now - INTERVAL '1 day'
   WHERE deck_id = v_deck;
  ASSERT (complete_goal_if_earned(v_goal)->>'completed')::boolean,
    'a goal at 100% mastery must be stamped';
  ASSERT (SELECT status FROM learning_goals WHERE id = v_goal) = 'completed',
    'the stamp must be written to the row';
  -- What it was earned against, so a later rule change cannot rewrite history.
  ASSERT (SELECT target->'completion'->>'rule' FROM learning_goals WHERE id = v_goal)
         = 'mature_ratio_v1',
    'the stamp must record the rule it was earned under';

  -- Idempotent, and one-way. The client calls this on every visit, and a lapse afterwards
  -- must not un-complete the goal: `again_days = 0` would otherwise take a two-card goal from
  -- 100% to 50% on a single wrong answer.
  ASSERT NOT (complete_goal_if_earned(v_goal)->>'changed')::boolean,
    'a second call must change nothing';
  UPDATE cards SET interval_days = 0, srs_status = 'learning' WHERE deck_id = v_deck;
  PERFORM complete_goal_if_earned(v_goal);
  ASSERT (SELECT status FROM learning_goals WHERE id = v_goal) = 'completed',
    'completion is a record; lapsing every card must not revoke it';

  RAISE NOTICE 'goal_knowledge_test: all assertions passed';
END $$;

ROLLBACK;
