-- One definition of a "mastered" card (migration 182).
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

  RAISE NOTICE 'mastery_definition_test: all assertions passed';
END $$;

ROLLBACK;
