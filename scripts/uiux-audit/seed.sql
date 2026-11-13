-- Local-only audit seed for uiux.audit@example.test. Never run against production.
DO $$
DECLARE
  u uuid := (SELECT id FROM auth.users WHERE email = 'uiux.audit@example.test');
  t_basic uuid := (SELECT id FROM card_templates WHERE user_id = u AND name LIKE '기본%' LIMIT 1);
  t_en uuid := (SELECT id FROM card_templates WHERE user_id = u AND name = '영어 단어' LIMIT 1);
  d1 uuid; d2 uuid; d3 uuid; i int;
  words text[] := ARRAY['abandon','benefit','candidate','deadline','efficient','feature','generate','highlight','improve','journey','knowledge','launch','maintain','negotiate','obtain','priority','quality','require','schedule','target','update','venture','warranty','yield','approach','budget','commit','define','estimate','focus'];
  means text[] := ARRAY['버리다','이익','후보자','마감','효율적인','특징','생성하다','강조하다','개선하다','여정','지식','출시하다','유지하다','협상하다','얻다','우선순위','품질','요구하다','일정','목표','갱신','모험적 사업','보증','산출하다','접근','예산','약속하다','정의하다','추정하다','집중'];
BEGIN
  UPDATE profiles SET locale = 'ko', onboarding_completed = true, display_name = '테스트', xp = 640, level = 6, daily_study_goal = 30 WHERE id = u;
  INSERT INTO decks (user_id, name, description, default_template_id, icon, color) VALUES (u, '토익 필수 단어', '매일 30개씩', t_en, '📘', '#3B82F6') RETURNING id INTO d1;
  INSERT INTO decks (user_id, name, description, default_template_id, icon, color) VALUES (u, '일본어 기초 회화', NULL, t_basic, '🗾', '#EF4444') RETURNING id INTO d2;
  INSERT INTO decks (user_id, name, description, default_template_id, icon, color) VALUES (u, '한국사 연표', '시험 대비', t_basic, '📜', '#10B981') RETURNING id INTO d3;
  FOR i IN 1..30 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position, srs_status, interval_days, repetitions, next_review_at, last_reviewed_at)
    VALUES (d1, u, t_en, jsonb_build_object('field_1', words[i], 'field_2', means[i], 'field_3', '', 'field_4', ''), i,
      CASE WHEN i <= 12 THEN 'review' WHEN i <= 18 THEN 'learning' ELSE 'new' END,
      CASE WHEN i <= 12 THEN i ELSE 0 END, CASE WHEN i <= 18 THEN 2 ELSE 0 END,
      CASE WHEN i <= 8 THEN now() - interval '1 day' WHEN i <= 18 THEN now() + (i || ' days')::interval ELSE NULL END,
      CASE WHEN i <= 18 THEN now() - (i || ' days')::interval ELSE NULL END);
  END LOOP;
  FOR i IN 1..15 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position) VALUES (d2, u, t_basic, jsonb_build_object('field_1', 'こんにちは ' || i, 'field_2', '안녕하세요 ' || i), i);
    INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position) VALUES (d3, u, t_basic, jsonb_build_object('field_1', (1392 + i * 20)::text || '년', 'field_2', '사건 ' || i), i);
  END LOOP;
  UPDATE decks SET next_position = 31 WHERE id = d1;
  UPDATE decks SET next_position = 16 WHERE id IN (d2, d3);
  FOR i IN 1..6 LOOP
    INSERT INTO study_sessions (user_id, deck_id, study_mode, cards_studied, total_cards, total_duration_ms, ratings, started_at, completed_at)
    VALUES (u, d1, 'srs', 10 + i, 20, 300000 + i * 30000, '{"again":2,"hard":3,"good":6,"easy":2}', now() - (i || ' days')::interval, now() - (i || ' days')::interval + interval '6 minutes');
  END LOOP;
END $$;
SELECT (SELECT count(*) FROM decks) AS decks, (SELECT count(*) FROM cards) AS cards, (SELECT count(*) FROM study_sessions) AS sessions;
