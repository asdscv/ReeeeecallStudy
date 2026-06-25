-- ============================================================================
-- 105: atomic card-position reservation (N1).
--
-- 문제: 카드 생성 3경로(card-store.createCard / createCards / api edge fn
-- createCards)가 모두 `SELECT decks.next_position` → insert(sort_position) →
-- `UPDATE decks.next_position` 의 read-modify-write. SELECT에 행잠금이 없어
-- 같은 덱에 동시 배치 생성 시 두 호출이 같은 next_position을 읽고 겹치는
-- sort_position을 부여(정렬 충돌) + next_position 손실. (mig 045
-- bulk_insert_cards 도 함수 내부에서 동일 패턴 — FOR UPDATE 없음.)
--
-- 해결: `UPDATE ... RETURNING` 한 문장으로 N칸을 원자적으로 예약. UPDATE가
-- 덱 행에 잠금을 걸어 동시 호출이 직렬화되고 각자 연속된 별도 블록을 받음.
-- 시작 sort_position 을 반환. (idempotent, additive — 기존 객체 미변경.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_card_positions(p_deck_id uuid, p_count integer)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_start integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RAISE EXCEPTION 'invalid count';
  END IF;

  -- 원자적 예약: UPDATE가 덱 행을 잠그므로 동시 호출이 직렬화됨.
  -- 소유자(auth.uid) 또는 service_role(Edge 함수가 사전에 소유권 검증)만 허용.
  UPDATE decks
     SET next_position = next_position + p_count,
         updated_at = now()
   WHERE id = p_deck_id
     AND (user_id = auth.uid() OR auth.role() = 'service_role')
  RETURNING next_position - p_count INTO v_start;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'deck not found or not owned';
  END IF;

  RETURN v_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_card_positions(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_card_positions(uuid, integer) TO authenticated, service_role;
