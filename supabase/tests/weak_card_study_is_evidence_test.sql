-- ============================================================================
-- "다시 볼 카드"를 학습하면 그 학습이 진단에 남아야 한다.
--
-- 약한 카드 목록은 `answer_attempts` 만 읽습니다(그 목표, 30일, 채점된 시도 2회 이상, 평균
-- 0.6 미만). 그 목록의 단 하나뿐인 버튼이 시작하는 세션은 플랜 항목이 없습니다 — 약한 카드는
-- 정의상 오늘 플랜에 없으니까요. 244 이전에는 `apply_study_rating` 이 플랜 항목을 못 찾으면
-- 그대로 돌아섰고, 학습자는 다섯 장을 다시 본 뒤 돌아와 똑같은 다섯 장을 봤습니다. 영원히.
--
-- 여기서 검사하는 것: 평점이 목표 시도로 남는가, 두 번 보내도 하나인가, 목표를 안 밝히면
-- 아무것도 안 남는가, 그리고 플랜 집계를 건드리지 않는가.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('fe000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('fe000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid    uuid := 'fe000000-0000-4000-8000-000000000001';
  v_other  uuid := 'fe000000-0000-4000-8000-000000000002';
  v_tpl    uuid; v_deck uuid; v_goal uuid; v_foreign_goal uuid;
  v_card   uuid; v_card2 uuid;
  v_event  uuid := gen_random_uuid();
  v_sess   uuid := gen_random_uuid();
  v_rev    bigint;
  -- 162:156 은 이 여섯 키가 정확히 다 있기를 요구합니다 — 하나라도 빠지거나 남으면 22023.
  v_srs    jsonb := jsonb_build_object(
             'srs_status', 'review', 'ease_factor', 2.5, 'interval_days', 3,
             'repetitions', 2,
             'next_review_at', to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
             'last_reviewed_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  r        jsonb;
  v_n      integer;
  v_score  numeric;
BEGIN
  SELECT id INTO v_tpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'weak deck', v_tpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tpl, '{"field_1":"a","field_2":"에이","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tpl, '{"field_1":"b","field_2":"비","field_3":"p","field_4":"e"}'::jsonb)
    RETURNING id INTO v_card2;

  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_uid, 'general', '약한 카드 목표', 20) RETURNING id INTO v_goal;
  INSERT INTO learning_goal_decks (goal_id, deck_id) VALUES (v_goal, v_deck);
  -- 남의 목표. 남의 목표 id 를 대신 보내도 아무것도 기록되면 안 됩니다.
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES (v_other, 'general', '남의 목표', 20) RETURNING id INTO v_foreign_goal;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- ══ 1. 목표를 밝히면 평점이 증거로 남는다 ════════════════════════════════
  SELECT srs_revision INTO v_rev FROM cards WHERE id = v_card;
  r := apply_study_rating(
    p_event_id => v_event, p_client_session_id => v_sess,
    p_card_id => v_card, p_deck_id => v_deck, p_study_mode => 'srs',
    p_rating => 'again', p_srs_source => 'embedded',
    p_expected_revision => v_rev, p_new_srs => v_srs, p_review_duration_ms => 4000,
    p_goal_id => v_goal);

  SELECT count(*), max(normalized_score) INTO v_n, v_score
    FROM answer_attempts WHERE user_id = v_uid AND card_id = v_card AND goal_id = v_goal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 약한 카드를 학습했는데 목표 시도가 % 개 — 진단은 이 표만 읽는다', v_n;
  END IF;
  -- 'again' 은 0.0. 이 숫자가 곧 다음 번 약한 카드 판정의 입력입니다.
  IF v_score <> 0.0 THEN RAISE EXCEPTION 'FAIL: again 이 % 로 기록됐다', v_score; END IF;
  IF (r ->> 'recorded_attempt_client_id')::uuid <> v_event THEN
    RAISE EXCEPTION 'FAIL: 되돌리기가 찾을 키를 안 돌려줬다 (%)', r;
  END IF;
  -- 플랜 항목은 붙지 않습니다 — 플랜에 없던 카드라 완료할 항목도 없습니다.
  IF EXISTS (SELECT 1 FROM answer_attempts
              WHERE user_id = v_uid AND card_id = v_card AND plan_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: 플랜에 없는 카드인데 플랜 항목이 붙었다';
  END IF;

  -- ══ 2. 재전송은 시도를 두 번 만들지 않는다 ═══════════════════════════════
  --
  -- 평점 자체는 `p_event_id` 로 이미 멱등입니다. 증거 쪽이 따라가지 않으면 네트워크가 한 번
  -- 끊긴 학습자의 오답이 두 번 세어져 카드가 실제보다 약해 보입니다.
  BEGIN
    r := apply_study_rating(
      p_event_id => v_event, p_client_session_id => v_sess,
      p_card_id => v_card, p_deck_id => v_deck, p_study_mode => 'srs',
      p_rating => 'again', p_srs_source => 'embedded',
      p_expected_revision => v_rev, p_new_srs => v_srs, p_review_duration_ms => 4000,
      p_goal_id => v_goal);
  EXCEPTION WHEN others THEN
    -- 평점 코어가 재전송을 어떻게 다루든(멱등 반환이든 거절이든) 여기서 보려는 것은
    -- 시도가 늘지 않았다는 것뿐입니다.
    NULL;
  END;
  SELECT count(*) INTO v_n
    FROM answer_attempts WHERE user_id = v_uid AND card_id = v_card;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL: 같은 평점을 두 번 보냈더니 시도가 % 개', v_n; END IF;

  -- ══ 3. 되돌리기가 이 시도까지 지운다 ═════════════════════════════════════
  --
  -- 5초 되돌리기가 스케줄만 되돌리면, 철회된 답이 진단에 계속 남아 카드를 약하게 만듭니다.
  -- `undo_study_rating` 은 세션의 **가장 최근** 평점만 받으므로 여기서 바로 검사합니다.
  PERFORM undo_plan_study_rating(v_event, v_event);
  SELECT count(*) INTO v_n FROM answer_attempts WHERE user_id = v_uid AND card_id = v_card;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: 되돌렸는데 시도가 % 개 남았다 — 철회한 답이 진단에 남는다', v_n;
  END IF;

  -- ══ 4. 목표를 안 밝히면 아무것도 안 남는다 ═══════════════════════════════
  --
  -- 평범한 덱 학습입니다. 어느 목표의 증거인지 알 수 없는 답을 목표에 붙이면 엉뚱한 플랜이
  -- 움직입니다 — 226 이 두 목표에 걸친 덱에서 아무 목표도 고르지 않는 것과 같은 이유.
  SELECT srs_revision INTO v_rev FROM cards WHERE id = v_card2;
  PERFORM apply_study_rating(
    p_event_id => gen_random_uuid(), p_client_session_id => v_sess,
    p_card_id => v_card2, p_deck_id => v_deck, p_study_mode => 'srs',
    p_rating => 'good', p_srs_source => 'embedded',
    p_expected_revision => v_rev, p_new_srs => v_srs, p_review_duration_ms => 1000);
  SELECT count(*) INTO v_n FROM answer_attempts WHERE user_id = v_uid AND card_id = v_card2;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 목표 없는 덱 학습이 시도 % 개를 남겼다', v_n; END IF;

  -- ══ 5. 남의 목표로는 기록되지 않는다 ═════════════════════════════════════
  SELECT srs_revision INTO v_rev FROM cards WHERE id = v_card2;
  PERFORM apply_study_rating(
    p_event_id => gen_random_uuid(), p_client_session_id => v_sess,
    p_card_id => v_card2, p_deck_id => v_deck, p_study_mode => 'srs',
    p_rating => 'good', p_srs_source => 'embedded',
    p_expected_revision => v_rev, p_new_srs => v_srs, p_review_duration_ms => 1000,
    p_goal_id => v_foreign_goal);
  SELECT count(*) INTO v_n FROM answer_attempts WHERE goal_id = v_foreign_goal;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL: 남의 목표에 시도 % 개가 붙었다', v_n; END IF;

  RAISE NOTICE 'weak_card_study_is_evidence_test: all assertions passed';
END $$;

ROLLBACK;
