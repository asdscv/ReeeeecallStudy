-- 265: 못 만드는 카드가 있으면 **다른 카드로 채웁니다.**
--
-- 요청한 문항 수만큼 나오는 것이 정상입니다. 264 까지의 상태는 그렇지 않았습니다:
-- 카드 3장으로 서술형 3문항을 요청하면 그중 한 장이 검증에 걸릴 때 2문항짜리 퀴즈가
-- 나왔습니다. 학습자는 3을 골랐고, 값도 3문항어치로 견적을 봤습니다.
--
-- 근본 원인(한 글자 답이 근거 검사에서 무조건 탈락)은 앞선 커밋에서 고쳤고, 같은 덱에서
-- 수율이 25/25 로 올라왔습니다. 그래도 **보장**은 아닙니다 — 모델은 확률적이고, 어떤 카드는
-- 그 유형에 정말 안 맞습니다(한 단어짜리 카드로 서술형 루브릭을 세울 수 없습니다).
--
-- 보장은 카드를 **바꾸는** 것에서 옵니다. 덱에 적격 카드가 429장 있는데 3장 중 1장이 안
-- 된다고 2문항으로 끝낼 이유가 없습니다.
--
-- ── 왜 새 함수인가 ─────────────────────────────────────────────────────────
--
-- 적격성 규칙은 이미 `_quiz_eligible_cards` 에 있고, `create_quiz_set` 이 처음 카드를 고를 때
-- 쓰는 바로 그 규칙입니다. 엣지에서 `cards` 를 직접 골라 오면 그 규칙의 **두 번째 사본**이
-- 생기고, 둘이 갈라지는 날 "견적에는 세어졌는데 생성에는 안 뽑히는 카드"가 나옵니다 —
-- 221 이 고쳤던 바로 그 실패입니다. 그래서 같은 함수를 감싸기만 합니다.
CREATE OR REPLACE FUNCTION public.quiz_substitute_cards(
  p_set_id  uuid,
  p_exclude uuid[] DEFAULT '{}'::uuid[],
  p_limit   integer DEFAULT 5
) RETURNS TABLE (card_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_set quiz_sets%ROWTYPE;
BEGIN
  -- 엣지 함수만 부릅니다. 학습자가 직접 부를 이유가 없고, 부를 수 있으면 남의 세트 id 로
  -- 그 덱에 무슨 카드가 있는지 훑는 통로가 됩니다.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz set not found' USING errcode = 'P0003';
  END IF;

  RETURN QUERY
  SELECT e.card_id
    FROM public._quiz_eligible_cards(
           v_set.owner_user_id, v_set.deck_id, v_set.scope_kind,
           COALESCE(v_set.scope_tags, '{}'::text[]),
           COALESCE(v_set.scope_card_ids, '{}'::uuid[])) e
   WHERE NOT (e.card_id = ANY (COALESCE(p_exclude, '{}'::uuid[])))
     -- 이미 이 세트에 문항이 있는 카드는 후보가 아닙니다. 같은 카드로 두 문항을 만들면
     -- 학습자는 같은 것을 두 번 풉니다.
     AND NOT EXISTS (
       SELECT 1 FROM quiz_questions q WHERE q.set_id = p_set_id AND q.card_id = e.card_id)
   -- 무작위입니다. 앞에서부터 집으면 대체는 늘 덱의 같은 구석에서 나옵니다.
   ORDER BY random()
   LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 5), 20));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.quiz_substitute_cards(uuid, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.quiz_substitute_cards(uuid, uuid[], integer)
  TO service_role;

COMMENT ON FUNCTION public.quiz_substitute_cards(uuid, uuid[], integer) IS
  '문항을 못 만든 카드 대신 쓸 적격 카드. 규칙은 _quiz_eligible_cards 그대로 — 두 번째 사본을 만들지 않기 위해 감싸기만 합니다.';
