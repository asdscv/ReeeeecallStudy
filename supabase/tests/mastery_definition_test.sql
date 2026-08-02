-- One definition of a "mastered" card (migration 183).
--
-- The rule this replaces was not a mastery test: `ease_factor` starts at 2.5 and gains +0.05 per
-- correct review, so `ease_factor > 2.5 AND srs_status = 'review'` fired after a SINGLE right
-- answer. Achievements and the dashboard then reported different numbers for the same word.
--
-- The cases below are built so the two rules DISAGREE. A test whose fixtures both rules classify
-- identically would pass whichever one is wired, and would have let the bug through.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('c1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_uid   uuid := 'c1000000-0000-4000-8000-000000000001';
  v_deck  uuid;
  v_tmpl  uuid;
  v_old   bigint;
  v_new   bigint;
BEGIN
  INSERT INTO card_templates (user_id, name, fields)
    VALUES (v_uid, 'T', '[{"key":"front","name":"Front","type":"text"}]'::jsonb)
    RETURNING id INTO v_tmpl;
  INSERT INTO decks (user_id, name, default_template_id)
    VALUES (v_uid, 'Mastery deck', v_tmpl) RETURNING id INTO v_deck;

  INSERT INTO cards (deck_id, user_id, template_id, field_values, srs_status, ease_factor, interval_days)
  VALUES
    -- Answered correctly ONCE: ease has ticked to 2.545 and the interval is a single day. The
    -- old rule called this mastered. It is the whole defect, in one row.
    (v_deck, v_uid, v_tmpl, '{"front":"once"}'::jsonb,      'review',  2.545,  1),
    -- Genuinely retained across weeks, but a hard card whose ease fell below the default. The
    -- old rule EXCLUDED this one — the exact inverse mistake, and the more insulting of the two.
    (v_deck, v_uid, v_tmpl, '{"front":"hard-but-known"}'::jsonb, 'review', 2.10, 90),
    -- Retained and easy: both rules agree.
    (v_deck, v_uid, v_tmpl, '{"front":"solid"}'::jsonb,     'review',  2.80,  60),
    -- Still being learned: neither rule counts it.
    (v_deck, v_uid, v_tmpl, '{"front":"learning"}'::jsonb,  'learning', 2.50,  0),
    -- Suspended with a long interval — the status filter is the only thing keeping it out.
    -- Added after a mutation run: dropping `srs_status = 'review'` from the helper changed
    -- nothing without it, so the filter was untested.
    (v_deck, v_uid, v_tmpl, '{"front":"suspended"}'::jsonb, 'suspended', 2.60, 100);

  SELECT count(*) INTO v_old FROM cards
    WHERE user_id = v_uid AND ease_factor > 2.5 AND srs_status = 'review';
  SELECT mature_card_count(v_uid) INTO v_new;

  -- The fixtures must actually separate the rules, or this file proves nothing.
  ASSERT v_old = 2, format('old rule should count once+solid, got %s', v_old);
  -- Both rules exclude the suspended card via the status filter, so it does not separate them.
  -- It earns its place by making that filter LOAD-BEARING for the new rule: with interval 100 it
  -- would be counted the moment `srs_status = 'review'` were dropped from the helper.
  ASSERT v_new = 2, format('new rule should count hard-but-known+solid, got %s', v_new);
  ASSERT EXISTS (SELECT 1 FROM cards WHERE user_id = v_uid AND field_values->>'front' = 'once'
                 AND ease_factor > 2.5 AND interval_days < 21),
    'the one-correct-answer card must be counted by the OLD rule and not the new one';
  ASSERT EXISTS (SELECT 1 FROM cards WHERE user_id = v_uid AND field_values->>'front' = 'hard-but-known'
                 AND ease_factor <= 2.5 AND interval_days >= 21),
    'the retained-but-hard card must be counted by the NEW rule and not the old one';

  -- 21 days is the boundary, and it is inclusive — the dashboard's `getMasteryRate` uses `>=`.
  UPDATE cards SET interval_days = 21 WHERE user_id = v_uid AND field_values->>'front' = 'once';
  SELECT mature_card_count(v_uid) INTO v_new;
  ASSERT v_new = 3, format('interval exactly 21 must count, got %s', v_new);
  UPDATE cards SET interval_days = 20 WHERE user_id = v_uid AND field_values->>'front' = 'once';
  SELECT mature_card_count(v_uid) INTO v_new;
  ASSERT v_new = 2, format('interval 20 must not count, got %s', v_new);

  -- Both callers must go through the helper, or the split simply moves rather than closing.
  ASSERT (SELECT position('mature_card_count' IN prosrc) FROM pg_proc WHERE proname = 'check_achievements') > 0,
    'check_achievements still carries its own mastery expression';
  ASSERT (SELECT position('mature_card_count' IN prosrc) FROM pg_proc WHERE proname = 'get_next_goals') > 0,
    'get_next_goals still carries its own mastery expression';
  ASSERT (SELECT position('ease_factor > 2.5' IN prosrc) FROM pg_proc WHERE proname = 'check_achievements') = 0,
    'check_achievements still counts a single correct answer as mastery';

  -- ── the helper must not be a cross-user read ──────────────────────────────
  -- It takes a uuid and checks nothing, so as SECURITY DEFINER granted to `authenticated` it
  -- bypassed RLS on `cards` for any id a caller supplied — and ids are enumerable through
  -- `get_leaderboard`. It is SECURITY INVOKER now and not granted to authenticated at all.
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'mature_card_count'),
    'mature_card_count is SECURITY DEFINER again — it has no ownership guard, so RLS is its only protection';
  ASSERT NOT has_function_privilege('authenticated', 'public.mature_card_count(uuid)', 'EXECUTE'),
    'mature_card_count is reachable from PostgREST again';
  ASSERT NOT has_function_privilege('anon', 'public.mature_card_count(uuid)', 'EXECUTE'),
    'mature_card_count is reachable by anon';

  RAISE NOTICE 'mastery_definition_test: all assertions passed';
END $$;

-- ── an unauthenticated caller must not be able to award badges or XP ─────────
-- `p_user_id <> auth.uid()` is NULL when there is no caller, so the whole conjunction was NULL
-- and the guard never fired: as `anon`, `check_achievements('<any uuid>')` awarded achievements
-- and XP to a stranger's account. Asserted here as a separate block because the role has to
-- change, and a failed PERFORM would poison the block above.
DO $$
DECLARE
  v_award_allowed boolean := false;
  v_read_allowed  boolean := false;
BEGIN
  -- `auth.uid()` reads `request.jwt.claim.sub` (SINGULAR) before falling back to the `claims`
  -- json, and this file sets the singular form session-wide at the top. Clearing only `claims`
  -- left auth.uid() returning the owner, so the first version of this block simulated the owner
  -- and proved nothing.
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  -- Recorded in a flag, NOT raised here. The refusal these functions produce is itself P0001
  -- (a bare `RAISE EXCEPTION 'Unauthorized'` defaults to it), so a failure raised inside the
  -- handler would be caught by that same handler and the test would pass while anon walked
  -- straight through. Mutating the guards away proved exactly that before this rewrite.
  BEGIN
    PERFORM check_achievements('c1000000-0000-4000-8000-000000000001');
    v_award_allowed := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    PERFORM get_next_goals('c1000000-0000-4000-8000-000000000001');
    v_read_allowed := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  ASSERT NOT v_award_allowed, 'anon was allowed to award achievements and XP to another account';
  ASSERT NOT v_read_allowed, 'anon was allowed to read another account''s next goals';
  RAISE NOTICE 'mastery_definition_test: anon is refused';
END $$;

-- ── the next goal must never be one the learner already holds ────────────────
-- `get_next_milestone` reads the current count alone, so tightening the mastery rule would hand
-- someone wearing the 1,000-card badge a next goal of 50.
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE v_target bigint;
BEGIN
  INSERT INTO user_achievements (user_id, achievement_id)
    VALUES ('c1000000-0000-4000-8000-000000000001', 'mastery_1000') ON CONFLICT DO NOTHING;
  SELECT (g->>'target')::bigint INTO v_target
    FROM json_array_elements((get_next_goals()->'goals')) g WHERE g->>'category' = 'mastery';
  ASSERT v_target > 1000, format('next mastery goal walked backwards to %s', v_target);
  RAISE NOTICE 'mastery_definition_test: next goal respects earned milestones';
END $$;

ROLLBACK;
