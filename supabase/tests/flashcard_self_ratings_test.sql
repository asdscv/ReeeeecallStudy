\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  learner uuid := gen_random_uuid();
  template uuid := gen_random_uuid();
  deck uuid := gen_random_uuid();
  card uuid := gen_random_uuid();
  mode text;
  v_rating text;
  session_id uuid;
  event_id uuid;
BEGIN
  INSERT INTO auth.users (id) VALUES (learner);
  INSERT INTO card_templates (id, user_id, name) VALUES (template, learner, 'Self ratings test');
  INSERT INTO decks (id, user_id, name) VALUES (deck, learner, 'Self ratings test');
  INSERT INTO cards (id, user_id, deck_id, template_id) VALUES (card, learner, deck, template);
  INSERT INTO deck_study_state (user_id, deck_id, sequential_pos) VALUES (learner, deck, 0);
  PERFORM set_config('request.jwt.claim.sub', learner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  FOREACH mode IN ARRAY ARRAY['random','sequential','by_date'] LOOP
    session_id := gen_random_uuid();
    FOREACH v_rating IN ARRAY ARRAY['known','unknown','next'] LOOP
      event_id := gen_random_uuid();
      PERFORM public.apply_study_rating(
        event_id, session_id, card, deck, mode, v_rating, 'none', NULL, NULL, 1000);
      ASSERT EXISTS (
        SELECT 1 FROM public.study_logs AS log
        WHERE log.rating_event_id = event_id AND log.rating = v_rating
          AND log.study_mode = mode AND log.card_id = card
      ), format('%s / %s was not saved', mode, v_rating);
    END LOOP;
    PERFORM public.finalize_study_session(
      session_id, deck, mode, now(),
      CASE WHEN mode = 'sequential' THEN '{"sequential_pos":0}'::jsonb END,
      CASE WHEN mode = 'sequential' THEN '{"sequential_pos":1}'::jsonb END,
      NULL);
    ASSERT EXISTS (
      SELECT 1 FROM public.study_sessions AS session
      WHERE session.deck_id = deck AND session.study_mode = mode
        AND session.cards_studied = 3
    ), format('%s summary did not count all ratings', mode);
  END LOOP;

  BEGIN
    PERFORM public.apply_study_rating(
      gen_random_uuid(), gen_random_uuid(), card, deck, 'sequential', 'easy', 'none', NULL, NULL, 1000);
    RAISE EXCEPTION 'Sequential study accepted an SRS rating';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  ASSERT (SELECT count(*) FROM study_logs WHERE card_id = card) = 9;
  ASSERT (SELECT srs_revision FROM cards WHERE id = card) = 0;
  ASSERT NOT has_function_privilege('authenticated',
    'public._apply_study_rating_core(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)', 'EXECUTE');
END;
$test$;

ROLLBACK;
