-- 266: 공부한 적 있는 덱을 지울 수 없었습니다.
--
-- 시뮬레이터에서 시드를 다시 깔다가 나왔고, 앱과 같은 경로로 재현했습니다:
--
--       DELETE /rest/v1/decks?id=eq.<시뮬레이터 덱>
--         → 400  23514  attempt_target_required
--
-- 얽힌 두 규칙이 서로를 막습니다.
--
--       answer_attempts.card_id  FK  ON DELETE SET NULL
--       CHECK attempt_target_required  (activity_id 또는 card_id 또는 quiz_run_item_id)
--
-- 카드를 지우면 FK 가 `card_id` 를 NULL 로 만들고, 카드가 **유일한 대상**이던 시도는 그
-- 순간 CHECK 를 위반합니다. 그래서 삭제 전체가 롤백됩니다. 덱 삭제는 카드 삭제를 타고
-- 내려가므로, 학습자가 한 번이라도 공부한 덱은 지워지지 않았습니다.
--
-- 프로덕션 범위: 시도 99건 중 70건이 카드만 대상이고, 시도를 가진 계정 3개가 **전부**
-- 해당합니다. 즉 "공부한 뒤 덱을 지운다"는 흔한 동작이 그동안 실패해 왔습니다.
--
-- ── 무엇을 고르는가 ────────────────────────────────────────────────────────
--
-- 시도는 "학습자가 **이 카드**에 이렇게 답했다"는 기록입니다. 카드가 사라지면 그 기록은
-- 가리킬 데가 없습니다 — 진단도 주간 요약도 그 행을 읽어 카드로 되짚는데, 되짚을 카드가
-- 없습니다. 그래서 대상이 카드뿐이던 시도는 카드와 함께 보냅니다.
--
-- CHECK 를 느슨하게 해서 대상 없는 행을 허용하는 길도 있지만, 그러면 집계에는 남고 아무도
-- 설명할 수 없는 숫자가 됩니다. 그건 기록이 아니라 잔해입니다.
--
-- 활동이나 퀴즈 회차에도 걸려 있는 시도는 **남깁니다.** 그 기록은 카드가 없어도 여전히
-- 읽힙니다 — FK 의 SET NULL 이 원래 하려던 일이 그것이고, 이 트리거는 그 일이 가능한
-- 행에는 손대지 않습니다.
BEGIN;

CREATE OR REPLACE FUNCTION public._drop_card_only_attempts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 카드가 유일한 대상인 시도만. 다른 대상이 하나라도 있으면 SET NULL 뒤에도 읽히므로 둡니다.
  DELETE FROM public.answer_attempts
   WHERE card_id = OLD.id
     AND activity_id IS NULL
     AND quiz_run_item_id IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_drop_card_only_attempts ON public.cards;
CREATE TRIGGER trg_drop_card_only_attempts
  BEFORE DELETE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public._drop_card_only_attempts();

COMMENT ON FUNCTION public._drop_card_only_attempts() IS
  '카드가 유일한 대상이던 시도를 카드와 함께 보냅니다. 없으면 FK 의 SET NULL 이 attempt_target_required 를 위반해 덱 삭제 전체가 23514 로 실패합니다.';

COMMIT;
