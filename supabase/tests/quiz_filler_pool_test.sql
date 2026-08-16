-- ============================================================================
-- The multiple-choice filler pool has to be a SAMPLE, not the first forty rows.
--
-- `create_quiz_set` returns up to forty other answers from the deck; the generator uses them
-- for the FAR distractor slots, because a model will not write a deliberately unrelated wrong
-- answer (ask it for wrong options for `lend → 빌려주다` and it returns 빌리다, 갚다, 임대하다
-- every time). So on any deck bigger than forty cards, THESE FORTY are the only wrong answers
-- the learner can ever be shown.
--
-- Until migration 238 they were the same forty every time:
--
--     SELECT array_agg(a ORDER BY random())
--       FROM (SELECT DISTINCT answer_text AS a FROM _quiz_eligible_cards(...) LIMIT 40) f
--
-- The `LIMIT 40` has no ORDER BY, so it takes whatever the scan yields first; the
-- `ORDER BY random()` then shuffles the forty already taken. Shuffling an order and drawing a
-- sample are different things, and written on one line the first reads like the second.
-- Verified on production against a 429-card deck: two consecutive pools, identical.
--
-- This test would have caught it. It builds a deck far larger than the pool and asks for the
-- pool repeatedly: if sampling is fixed, every draw is the same forty and the union stays at
-- forty. The assertion is on the UNION rather than on any two draws differing, because that is
-- true whatever the shuffle does and cannot flake.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('fa000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid  uuid := 'fa000000-0000-4000-8000-000000000001';
  v_tpl  uuid; v_deck uuid;
  r      jsonb;
  v_seen text[] := '{}';
  v_pool text[];
  v_n    integer;
  i      integer;
BEGIN
  SELECT id INTO v_tpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'filler pool', v_tpl)
    RETURNING id INTO v_deck;

  -- 150 cards, every answer distinct: comfortably more than the pool's forty, which is the
  -- only situation in which the bug is visible at all. A deck of forty or fewer always hands
  -- over everything it has and looks fine either way.
  FOR i IN 1..150 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tpl,
              jsonb_build_object('field_1', 'word' || i, 'field_2', 'meaning' || i,
                                 'field_3', 'pron' || i, 'field_4', 'ex' || i));
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  FOR i IN 1..5 LOOP
    r := public.create_quiz_set(v_deck, 'pool ' || i, 'mcq', 4, 'en');
    SELECT array_agg(value::text) INTO v_pool
      FROM jsonb_array_elements_text(r -> 'fillers');
    IF v_pool IS NULL OR array_length(v_pool, 1) <> 40 THEN
      RAISE EXCEPTION 'FAIL: pool % had % entries, expected 40', i, coalesce(array_length(v_pool, 1), 0);
    END IF;
    v_seen := v_seen || v_pool;
  END LOOP;

  SELECT count(DISTINCT u) INTO v_n FROM unnest(v_seen) u;
  -- Five draws of forty from 150 distinct answers covers ~113 of them on average. Forty means
  -- the sample never moved. Anything comfortably above forty means it did; 60 is low enough
  -- that no plausible run of luck reaches it and high enough to fail the fixed-pool bug loudly.
  IF v_n <= 60 THEN
    RAISE EXCEPTION 'FAIL: five pools of 40 covered only % distinct answers — the sample is fixed, not random', v_n;
  END IF;

  -- And the pool never contains a duplicate, which would waste a distractor slot.
  FOR i IN 1..1 LOOP
    r := public.create_quiz_set(v_deck, 'dupes', 'mcq', 4, 'en');
    SELECT count(*), count(DISTINCT value::text) INTO v_n, i
      FROM jsonb_array_elements_text(r -> 'fillers');
    IF v_n <> i THEN
      RAISE EXCEPTION 'FAIL: the pool repeated an answer (% entries, % distinct)', v_n, i;
    END IF;
  END LOOP;

  RAISE NOTICE 'quiz_filler_pool_test: all assertions passed (% distinct answers across 5 pools)',
    (SELECT count(DISTINCT u) FROM unnest(v_seen) u);
END $$;

ROLLBACK;
