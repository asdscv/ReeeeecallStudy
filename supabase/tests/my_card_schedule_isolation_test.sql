-- ============================================================================
-- `my_card_schedule` 은 **내** 카드 일정만 돌려준다.
--
-- 232 는 인자로 user id 를 받지 않는 것으로 위조를 막았다고 적었다. 그 문장은 user id 에
-- 대해서만 참이었다 — 함수는 `p_deck_ids` 를 그대로 받아 소유권 검사가 없는 경로로 넘겼고,
-- 배포 직전 감사에서 학습자 A 가 B 의 덱 id 로 B 의 카드 일정을 읽는 것이 재현됐다.
--
-- 그래서 이 파일은 두 방향을 함께 고정한다. 격리만 검사하면 "항상 빈 배열을 돌려준다"로도
-- 통과하고, 그건 고친 게 아니라 부순 것이다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-4000-8000-000000000001'),   -- A: 훔치려는 쪽
  ('b1000000-0000-4000-8000-000000000002')    -- B: 남의 덱 주인
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_a    uuid := 'a1000000-0000-4000-8000-000000000001';
  v_b    uuid := 'b1000000-0000-4000-8000-000000000002';
  v_tpl_a uuid := gen_random_uuid(); v_tpl_b uuid := gen_random_uuid();
  v_deck_a uuid := gen_random_uuid(); v_deck_b uuid := gen_random_uuid();
  v_shared uuid := gen_random_uuid();   -- B 소유이지만 A 가 카드를 만진 덱
  n integer;
BEGIN
  INSERT INTO card_templates (id, user_id, name, fields) VALUES
    (v_tpl_a, v_a, 'TA', '[]'::jsonb), (v_tpl_b, v_b, 'TB', '[]'::jsonb);
  INSERT INTO decks (id, user_id, name) VALUES
    (v_deck_a, v_a, 'A의 덱'), (v_deck_b, v_b, 'B의 덱'), (v_shared, v_b, 'B가 만들고 A가 공부한 덱');
  INSERT INTO cards (id, deck_id, user_id, template_id, field_values) VALUES
    (gen_random_uuid(), v_deck_a, v_a, v_tpl_a, '{"field_1":"A"}'::jsonb),
    (gen_random_uuid(), v_deck_b, v_b, v_tpl_b, '{"field_1":"B"}'::jsonb);
  -- A 가 공유 덱의 카드 한 장을 공부한다 → 그 덱은 A 의 라이브러리에 들어온다.
  INSERT INTO cards (id, deck_id, user_id, template_id, field_values)
    VALUES ('c1000000-0000-4000-8000-000000000003', v_shared, v_b, v_tpl_b, '{"field_1":"S"}'::jsonb);
  INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
    VALUES (v_a, 'c1000000-0000-4000-8000-000000000003', v_shared, 'new');

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);

  -- ── 1. 남의 덱 id 를 넘겨도 아무것도 안 나온다 ────────────────────────────
  SELECT count(*) INTO n FROM my_card_schedule(ARRAY[v_deck_b]);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: A 가 B 의 덱에서 %행을 읽었다', n;
  END IF;

  -- ── 2. 내 덱은 그대로 나온다 (격리가 기능을 죽이지 않았는가) ──────────────
  SELECT count(*) INTO n FROM my_card_schedule(ARRAY[v_deck_a]);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 내 덱을 물었는데 %행 (1이어야 함)', n;
  END IF;

  -- ── 3. 섞어서 넘기면 내 것만 ──────────────────────────────────────────────
  -- 남의 id 하나가 섞였다고 전체를 거절하면, 공유 덱이 있는 화면이 통째로 빈다.
  SELECT count(*) INTO n FROM my_card_schedule(ARRAY[v_deck_a, v_deck_b]);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 내 덱+남의 덱을 물었는데 %행 (내 것 1행만이어야 함)', n;
  END IF;

  -- ── 4. 내가 공부한 남의 덱은 보인다 ───────────────────────────────────────
  -- 멤버십 규칙은 소유권이 아니라 "내 덱 + 내가 만진 덱"이다. 소유권만 보면 구독한 덱의
  -- 진도가 통째로 사라진다.
  SELECT count(*) INTO n FROM my_card_schedule(ARRAY[v_shared]);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: 내가 공부한 덱이 %행 (1이어야 함)', n;
  END IF;

  -- ── 5. 인자 없이 부르면 내 라이브러리 전체 ────────────────────────────────
  SELECT count(*) INTO n FROM my_card_schedule();
  IF n < 2 THEN
    RAISE EXCEPTION 'FAIL: 인자 없는 호출이 %행 (내 덱 1 + 공유 덱 1 이상이어야 함)', n;
  END IF;

  RAISE NOTICE 'my_card_schedule_isolation_test: all assertions passed';
END $$;

-- ── 6. 내부 헬퍼는 밖에서 부를 수 없다 ──────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public._quiz_run_tally(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._quiz_run_tally(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: _quiz_run_tally 가 아직 anon/authenticated 에게 열려 있다';
  END IF;
  -- 그리고 그 넷은 여전히 부를 수 있어야 한다(전부 DEFINER 라 함수 소유자 권한으로 돈다).
  IF NOT has_function_privilege('authenticated', 'public.list_quiz_sets(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: list_quiz_sets 가 막혔다 — 헬퍼 권한 회수가 너무 넓게 갔다';
  END IF;
  RAISE NOTICE 'my_card_schedule_isolation_test: _quiz_run_tally 는 내부 전용';
END $$;

ROLLBACK;
