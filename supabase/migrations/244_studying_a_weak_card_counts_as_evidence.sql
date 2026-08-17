-- 244: "다시 볼 카드"를 아무리 학습해도 목록이 그대로였다.
--
-- 학습 진단의 약한 카드 목록은 `answer_attempts` 하나만 읽습니다 — 그 목표에서, 30일 안에,
-- 채점된 시도가 2회 이상이고 평균이 0.6 미만인 카드(`learning-insights.ts`). 그런데 그 목록의
-- 단 하나뿐인 버튼 "이 카드만 학습하기"가 시작하는 세션은 `answer_attempts` 에 아무것도 쓰지
-- 않습니다.
--
-- 이유는 그 세션에 플랜 항목이 없기 때문입니다. `apply_study_rating` 은 오늘 플랜의 pending
-- 항목을 찾아 거기에 시도를 붙이는데(204:401), 약한 카드는 **정의상 오늘 플랜에 없습니다** —
-- 오늘 볼 카드였다면 평소 큐가 이미 내줬을 테니까요. 그래서 `IF NOT FOUND THEN RETURN` 으로
-- 빠져나가고, 학습자는 다섯 장을 성실히 다시 본 뒤 돌아와 똑같은 다섯 장을 봅니다. 정렬은
-- 카드 id 로 결정적이라 순서까지 같습니다. 몇 번을 하든 영원히.
--
-- 스케줄은 정상적으로 움직였습니다. 움직이지 않은 것은 **그 다섯 장을 고른 판단** 쪽입니다.
--
-- ── 무엇을 바꾸나 ───────────────────────────────────────────────────────────
--
-- `apply_study_rating` 에 `p_goal_id` 를 붙입니다. 플랜 항목을 못 찾았어도 학습자가 어느 목표
-- 화면에서 왔는지 말해줬다면, 목표만 달린 시도를 기록합니다. 플랜 항목이 NULL 이므로
-- `daily_plans` 집계는 그대로입니다 — 플랜에 없던 카드이니 완료할 항목도 없습니다.
--
-- 기록은 `record_answer_attempt` 를 지나지 않고 직접 INSERT 합니다. 그 함수의 NULL 플랜항목
-- 경로는 실제로는 쓸 수 없습니다: 167:836 의 `IF p_plan_item_id IS NOT NULL AND
-- v_plan_item.status = 'pending'` 는 PL/pgSQL 이 식 전체를 한 번에 평가하기 때문에 배정되지
-- 않은 record 를 건드려 터집니다("record v_plan_item is not assigned yet"). 지금까지 아무도
-- 그 경로로 부른 적이 없어서 드러나지 않았을 뿐입니다. 226 이 퀴즈 답안에 대해 하는 것과
-- 같은 모양의 직접 INSERT 가 이 자리에서 정직합니다.
--
-- 멱등성은 `client_attempt_id = p_event_id` 로 잡습니다. 평점 이벤트 id 는 이미 평점 자체의
-- 멱등 키이고 `(user_id, client_attempt_id)` 에 UNIQUE 가 있으니, 재전송된 평점은 시도를 두 번
-- 만들지 않습니다. 그리고 그 키 덕분에 5초 되돌리기가 이 시도도 지웁니다 —
-- `undo_plan_study_rating` 은 `client_attempt_id` 로 찾아 지우고, 플랜 항목이 NULL 이면 플랜
-- 집계는 건드리지 않고 시도만 지웁니다(189:76-105). 클라이언트가 그 id 를 넘기도록 같은 변경에
-- 포함되어 있습니다.
--
-- 11인자 형태는 같은 트랜잭션에서 없앱니다. 모든 호출이 이름 인자라, 두 형태가 공존하면
-- `p_goal_id` 를 생략한 호출이 전부 ambiguous 로 실패합니다.
--
-- ── 학습자에게 보이는 변화 ─────────────────────────────────────────────────
--
-- 이제 평점이 점수로 남습니다(again 0.0 / hard 0.5 / good·easy 1.0 — 204 와 같은 지도). 평균이
-- 0.0 인 카드는 'good' 한 번으로 0.6 위로 올라오지 않습니다. 세 번 틀린 카드는 세 번쯤 맞혀야
-- 목록에서 빠집니다. 그게 맞는 동작이고, 그래서 목록이 **움직이기는** 합니다.
BEGIN;

DROP FUNCTION IF EXISTS public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean);

CREATE OR REPLACE FUNCTION public.apply_study_rating(
  p_event_id uuid,
  p_client_session_id uuid,
  p_card_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_rating text,
  p_srs_source text,
  p_expected_revision bigint DEFAULT NULL,
  p_new_srs jsonb DEFAULT NULL,
  p_review_duration_ms integer DEFAULT NULL,
  p_complete_plan_item boolean DEFAULT true,
  p_goal_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_item record;
  v_score numeric;
BEGIN
  -- The rating itself is unchanged and is NOT reimplemented here. `_apply_study_rating_core`
  -- holds the body that 160/162 built; this wrapper only adds the plan half.
  v_result := public._apply_study_rating_core(
    p_event_id, p_client_session_id, p_card_id, p_deck_id, p_study_mode,
    p_rating, p_srs_source, p_expected_revision, p_new_srs, p_review_duration_ms);

  IF NOT COALESCE(p_complete_plan_item, true) THEN
    RETURN v_result;
  END IF;
  -- No schedule moved → no day completed. See the header.
  IF p_new_srs IS NULL THEN
    RETURN v_result;
  END IF;

  -- Same map as 187, and deliberately the same numbers: a rating must not mean one
  -- thing when the learner came from the plan and another when they came from a deck.
  v_score := CASE p_rating
    WHEN 'again' THEN 0.0
    WHEN 'hard'  THEN 0.5
    WHEN 'good'  THEN 1.0
    WHEN 'easy'  THEN 1.0
    ELSE NULL
  END;
  IF v_score IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT * INTO v_item FROM public._pending_plan_item_for_card(v_uid, p_card_id);
  IF NOT FOUND THEN
    -- 244: no plan item, but the learner told us which goal they were working on. Record the
    -- rating as evidence for that goal so the panel that CHOSE this card can see the answer.
    --
    -- Only the learner's own goal, and nothing but the goal is asserted: the card need not be
    -- on any plan (that is the entire point), and a learner naming one of their own goals for
    -- their own card can at worst colour their own insights.
    IF p_goal_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM learning_goals g WHERE g.id = p_goal_id AND g.user_id = v_uid)
    THEN
      INSERT INTO answer_attempts (
        user_id, goal_id, card_id, client_attempt_id,
        activity_type, response_type, evaluator_type,
        response, normalized_score, duration_ms)
      VALUES (
        v_uid, p_goal_id, p_card_id, p_event_id,
        'recall', 'self_rate', 'self_rate',
        jsonb_build_object('self_rated', v_score, 'srs_rating', p_rating),
        v_score, COALESCE(p_review_duration_ms, 0))
      -- A retried rating carries the same event id. The rating half is already idempotent on
      -- it; this makes the evidence half agree rather than recording the same answer twice.
      ON CONFLICT (user_id, client_attempt_id) DO NOTHING;

      -- Told to the client so undo can retract this half too: `undo_plan_study_rating` finds
      -- an attempt by `client_attempt_id`, and with a NULL plan item it deletes the attempt
      -- and leaves every plan aggregate alone.
      RETURN v_result || jsonb_build_object('recorded_attempt_client_id', p_event_id);
    END IF;
    RETURN v_result;
  END IF;

  -- `p_event_id` is unique per rating and already the idempotency key for the rating
  -- event, so reusing it as the client attempt id makes a retried rating reuse its
  -- attempt instead of recording a second one.
  PERFORM public.record_answer_attempt(
    p_client_attempt_id => p_event_id,
    p_activity_type     => v_item.activity_type,
    p_response_type     => v_item.response_type,
    p_evaluator_type    => v_item.evaluator_type,
    p_response          => jsonb_build_object('self_rated', v_score, 'srs_rating', p_rating),
    p_goal_id           => v_item.goal_id,
    p_activity_id       => NULL,
    p_card_id           => p_card_id,
    p_plan_item_id      => v_item.item_id,
    p_normalized_score  => v_score,
    p_duration_ms       => COALESCE(p_review_duration_ms, 0)
  );

  -- Reported so a client can tell the difference between "rated" and "rated, and it
  -- finished today's item" without a second round trip.
  RETURN v_result || jsonb_build_object('completed_plan_item_id', v_item.item_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean, uuid) TO authenticated;

COMMENT ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean, uuid) IS
  'Apply an SRS rating; complete the pending self-rated plan item for that card in the learner''s own today, or — when there is no such item and a goal was named — record the rating as goal-scoped evidence so the diagnostics that chose the card can see the answer.';

COMMIT;
