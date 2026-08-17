-- 244 되돌리기: `apply_study_rating` 을 204 의 11인자 형태로 복원합니다.
--
-- 되돌리면 "다시 볼 카드" 학습은 다시 아무 증거도 남기지 않습니다 — 스케줄은 움직이지만 그
-- 카드를 고른 진단은 영원히 같은 목록을 냅니다. 12인자 형태를 먼저 없애야 이름 인자 호출이
-- ambiguous 가 되지 않습니다.
--
-- 이미 기록된 목표 시도(플랜 항목 NULL)는 지우지 않습니다. 학습자가 실제로 답한 것이고,
-- 정확도·약한 카드 계산에 그대로 유효합니다.
BEGIN;

DROP FUNCTION IF EXISTS public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean, uuid);

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
  p_complete_plan_item boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_item record;
  v_score numeric;
BEGIN
  v_result := public._apply_study_rating_core(
    p_event_id, p_client_session_id, p_card_id, p_deck_id, p_study_mode,
    p_rating, p_srs_source, p_expected_revision, p_new_srs, p_review_duration_ms);

  IF NOT COALESCE(p_complete_plan_item, true) THEN
    RETURN v_result;
  END IF;
  IF p_new_srs IS NULL THEN
    RETURN v_result;
  END IF;

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
    RETURN v_result;
  END IF;

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

  RETURN v_result || jsonb_build_object('completed_plan_item_id', v_item.item_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean) TO authenticated;

COMMIT;
