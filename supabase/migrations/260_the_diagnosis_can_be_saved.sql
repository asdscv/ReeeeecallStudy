-- 260: 학습 진단이 저장되지 않아 **한 번도 성공한 적이 없습니다**.
--
-- 246 이 진단(`diagnose`)을 붙이면서 예약(`reserve_ai_remediation`)과 값(`ai_action_prices`)은
-- 넣었는데, 결과를 쓰는 `persist_ai_remediation` 의 허용 목록에는 넣지 않았습니다:
--
--       p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend')
--           → RAISE 'Invalid remediation payload'
--
-- 그래서 진단은 근거를 세고, 홀드를 잡고, 모델을 부르고, 결과를 검증한 **다음** 저장에서
-- 터졌습니다. 엣지가 그 예외를 PERSISTENCE 로 받아 홀드를 풀고 502 를 돌려줍니다.
--
-- 프로덕션에서 실제 계정으로 확인한 것:
--
--       POST ai-generate {kind:'remediation', action:'diagnose', ...}
--         → 502 AI_PERSISTENCE_ERROR,  차감 0
--       SELECT count(*) FROM user_enrichments WHERE action = 'diagnose'  →  0
--
-- 돈은 한 푼도 잘못 나가지 않았습니다(release 가 제대로 돌았습니다). 대신 기능이 통째로
-- 죽어 있었고, 학습자가 보는 것은 "처리하지 못했어요 · 다시 시도"이며 재시도는 같은 자리에서
-- 같은 방식으로 실패합니다. 246 의 테스트가 증거 수집(`get_learning_diagnosis_evidence`)만
-- 보고 저장까지 따라가지 않아 CI 가 초록이었습니다.
--
-- 고칩니다: 목록에 `diagnose` 를 넣습니다. 정의는 178 의 본문 그대로이고 그 한 줄만 다릅니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.persist_ai_remediation(
  p_user_id uuid,
  p_action text,
  p_content jsonb,
  p_source_refs uuid[] DEFAULT '{}'::uuid[],
  p_goal_id uuid DEFAULT NULL,
  p_concept_id uuid DEFAULT NULL,
  p_card_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_request_fingerprint text DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_prompt_version text DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_action NOT IN ('explain','compare','hint','diagnose','generate','evaluate','recommend')
     OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
     OR octet_length(p_content::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid remediation payload' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals
    WHERE id = p_goal_id AND user_id = p_user_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Goal ownership mismatch' USING errcode = '42501';
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_activities
    WHERE id = p_activity_id AND (owner_user_id = p_user_id OR owner_user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501'; END IF;
  -- The attempt must belong to the same user the enrichment is being written for. The
  -- reserve step already checked it against auth.uid(), but this function runs as
  -- service_role with a caller-supplied p_user_id, so it cannot inherit that check.
  IF p_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM answer_attempts WHERE id = p_attempt_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Attempt not accessible' USING errcode = '42501'; END IF;
  -- ...and if BOTH are card-scoped they must name the SAME card. Ownership alone would still
  -- allow storing "card X, grounded in the learner's attempt on card Y": provenance that
  -- misdescribes the answer is worse than none, because a stored attempt_id reads as verified.
  -- `attemptId` and `cardId` arrive as independent fields of the request body, so the server
  -- cannot rely on the client helper that pairs them correctly.
  --
  -- Deliberately silent when the attempt has NO card: `answer_attempts.card_id` is nullable and
  -- `attempt_activity_or_card_required` (mig 165:228) allows an activity-only attempt. Pairing
  -- one of those with a card reference is legitimate — `reserve_ai_remediation` accepts any
  -- combination of goal/activity/attempt/cards — and rejecting it would break a valid request
  -- to close a hole that only exists when the attempt actually names a different card.
  IF p_attempt_id IS NOT NULL AND p_card_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM answer_attempts
    WHERE id = p_attempt_id AND card_id IS NOT NULL AND card_id <> p_card_id
  ) THEN RAISE EXCEPTION 'Attempt does not belong to the card' USING errcode = '42501'; END IF;
  IF p_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cards c JOIN decks d ON d.id = c.deck_id
    WHERE c.id = p_card_id AND c.user_id = d.user_id AND (
      (d.user_id = p_user_id AND (
        public.get_active_card_threshold() IS NULL
        OR c.created_at <= public.get_active_card_threshold()
        OR (EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
            AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false))
      ))
      OR (EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.deck_id = d.id AND ds.recipient_id = p_user_id
          AND ds.share_mode = 'subscribe' AND ds.status = 'active'
      ) AND public.is_subscribed_deck_active(d.id))
    )
  ) THEN RAISE EXCEPTION 'Card not accessible' USING errcode = '42501'; END IF;
  IF p_concept_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_concepts c
    WHERE c.id = p_concept_id AND (
      c.owner_user_id = p_user_id OR (
        c.owner_user_id IS NULL AND p_goal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM learning_goal_concepts gc
          WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  INSERT INTO user_enrichments
    (user_id, goal_id, concept_id, card_id, activity_id, attempt_id, action, request_fingerprint,
     content, source_references, model_version, provider, prompt_version, status)
  VALUES
    (p_user_id, p_goal_id, p_concept_id, p_card_id, p_activity_id, p_attempt_id, p_action,
     NULLIF(left(COALESCE(p_request_fingerprint, ''), 128), ''), p_content,
     to_jsonb(COALESCE(p_source_refs, '{}'::uuid[])), left(p_model_version, 200), left(p_provider, 100),
     left(p_prompt_version, 100), 'preview')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_ai_remediation(
  uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_ai_remediation(
  uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text, uuid)
  TO service_role;

COMMIT;
