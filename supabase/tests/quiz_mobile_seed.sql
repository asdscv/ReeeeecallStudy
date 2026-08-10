-- Seeds the account `__tests__/e2e/specs/quiz.spec.ts` runs against.
--
-- Usage:
--   1. create the auth user once (any client), then put its uuid in v_uid below;
--   2. supabase db query --file supabase/tests/quiz_mobile_seed.sql --linked
--   3. packages/mobile/.env.test must hold the same E2E_TEST_EMAIL / E2E_TEST_PASSWORD.
--
-- The mobile app points at PRODUCTION (`packages/mobile/app.config.js` hardcodes the prod
-- URL as its fallback), so seeding a local Supabase is invisible to the simulator. This runs
-- against prod, and writes only under one throwaway account.
--
-- Seeds the iOS simulator run with a deterministic quiz set.
--
-- Hand-written rather than generated: the flaw layout is then a KNOWN fact, so the on-screen
-- check "the option carrying no flaw label is the answer" tests migration 203 rather than
-- testing whatever the model happened to return. Costs no AI units.
DO $$
DECLARE
  v_uid  uuid := '2fa09ec3-d851-4cf8-91a6-4960dd1e07e8';
  v_tpl  uuid;
  v_deck uuid;
  v_mcq  uuid;
  v_short uuid;
  r      record;
  i      int := 0;
BEGIN
  DELETE FROM quiz_sets WHERE owner_user_id = v_uid;
  DELETE FROM decks WHERE user_id = v_uid;

  SELECT id INTO v_tpl FROM card_templates WHERE name = '영어 단어' LIMIT 1;

  INSERT INTO decks (user_id, name, default_template_id)
    VALUES (v_uid, '시뮬레이터 덱', v_tpl) RETURNING id INTO v_deck;

  INSERT INTO cards (deck_id, user_id, template_id, field_values)
  SELECT v_deck, v_uid, v_tpl, jsonb_build_object(
           'field_1', w, 'field_2', m, 'field_3', p, 'field_4', e)
    FROM (VALUES
      ('glacier','빙하','ˈɡleɪʃər','The glacier is retreating.'),
      ('compass','나침반','ˈkʌmpəs','Use a compass to navigate.'),
      ('auction','경매','ˈɔːkʃən','It sold at auction.'),
      ('harbour','항구','ˈhɑːrbər','The boat left the harbour.'),
      ('vaccine','백신','vækˈsiːn','The vaccine is free.'),
      ('lullaby','자장가','ˈlʌləbaɪ','She sang a lullaby.')
    ) AS v(w,m,p,e);

  -- ── multiple choice: three questions, answers at three DIFFERENT stored indexes ──
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, content_locale, difficulty, generated_count)
    VALUES (v_uid, v_deck, '시뮬 객관식', 'mcq', 'deck', 3, 'ko', 3, 3)
    RETURNING id INTO v_mcq;

  FOR r IN
    SELECT c.id AS card_id, c.field_values->>'field_1' AS w, c.field_values->>'field_2' AS m
      FROM cards c WHERE c.deck_id = v_deck
       AND c.field_values->>'field_1' IN ('glacier','compass','auction')
     ORDER BY c.field_values->>'field_1'
  LOOP
    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      options, correct_index, reference_answer, source_fingerprint, difficulty, meta)
    VALUES (
      v_mcq, v_uid, r.card_id, 'mcq', i, r.w,
      CASE r.w
        WHEN 'auction' THEN ARRAY['경매','벼룩시장','경례','정가 판매']
        WHEN 'compass' THEN ARRAY['지도','나침반','시계','고도계']
        ELSE                ARRAY['빙산','만년설','빙하','화산']
      END,
      -- The answer sits at a different index in each, so a flaw list served in STORED order
      -- instead of SERVED order cannot accidentally look correct.
      CASE r.w WHEN 'auction' THEN 0 WHEN 'compass' THEN 1 ELSE 2 END,
      r.m, 'sim-' || r.w, 3,
      jsonb_build_object('flaws', CASE r.w
        WHEN 'auction' THEN '[null,"right_category_wrong_item","plausible_form","opposite"]'::jsonb
        WHEN 'compass' THEN '["adjacent_sense",null,"right_category_wrong_item","adjacent_sense"]'::jsonb
        ELSE               '["plausible_form","adjacent_sense",null,"right_category_wrong_item"]'::jsonb
      END));
    i := i + 1;
  END LOOP;

  -- ── short answer: the type where grading is priced, and where 다음/마치기 used to vanish ──
  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, content_locale, difficulty, generated_count)
    VALUES (v_uid, v_deck, '시뮬 주관식', 'short', 'deck', 2, 'ko', 3, 2)
    RETURNING id INTO v_short;

  i := 0;
  FOR r IN
    SELECT c.id AS card_id, c.field_values->>'field_1' AS w, c.field_values->>'field_2' AS m
      FROM cards c WHERE c.deck_id = v_deck
       AND c.field_values->>'field_1' IN ('harbour','vaccine')
     ORDER BY c.field_values->>'field_1'
  LOOP
    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      reference_answer, source_fingerprint, difficulty, meta)
    VALUES (v_short, v_uid, r.card_id, 'short', i,
            '''' || r.w || '''의 뜻은 무엇인가요?', r.m, 'sim-s-' || r.w, 3, '{}'::jsonb);
    i := i + 1;
  END LOOP;

  -- Needs auth.uid(); service_role alone is not a user.
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM public.grant_ai_quiz_trial();
END $$;

SELECT s.title, s.question_type, s.generated_count,
       (SELECT count(*) FROM quiz_questions q WHERE q.set_id = s.id) AS questions
  FROM quiz_sets s WHERE s.owner_user_id = '2fa09ec3-d851-4cf8-91a6-4960dd1e07e8'
 ORDER BY s.title;
