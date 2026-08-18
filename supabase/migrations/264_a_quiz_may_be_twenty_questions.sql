-- 264: 화면이 고를 수 없는 길이를 보여 주고 있었습니다.
--
-- 설정 화면의 선택지는 [4, 6, 8, 10, 12, 20, 30, 50] 인데 스키마는 12 에서 막았습니다.
-- 프로덕션에서 실제로 눌러 본 결과:
--
--       12문항 → 200 ok
--       20문항 → 400  (23514, quiz_sets_requested_count_check)
--       30문항 → 400
--       50문항 → 400
--
-- 학습자가 20을 고르면 원시 제약 위반이 돌아옵니다. #466(2026-08-10)이 고치려던 것이 이건데,
-- 그 PR 이 열린 채로 있는 동안 화면 쪽 선택지만 먼저 들어가서 이 상태가 됐습니다. 그 PR 은
-- 마이그레이션 번호가 이미 쓰인 204·205 라 그대로 올릴 수 없고, 함께 담긴 "퀴즈 무료 폐지"는
-- 그 뒤 결정(무료 티어 — 카드 10장 + 퀴즈 5문항)과 정반대입니다. 그래서 길이만 여기서 엽니다.
--
-- ── 왜 20 인가, 그리고 왜 30·50 은 아닌가 ──────────────────────────────────
--
-- 한 번의 호출이 퀴즈 전체를 만들지 않습니다. 클라이언트가 `QUIZ_BATCH_SIZE`(객관식 8 ·
-- 주관식 8 · 서술형 3)로 쪼개 여러 번 부르고, `persist_quiz_questions` 가 이어 붙입니다
-- (mig 207). 그래서 호출당 유닛은 객관식 16 · 주관식 8 · 서술형 9 로, `quiz_max_units_per_call`
-- 40 에 닿지 않습니다 — **이 마이그레이션은 유닛 상한을 건드리지 않습니다.**
--
-- 20 은 배치 수가 아직 납득할 만한 지점입니다: 객관식 3배치, 서술형 7배치. 30·50 은 서술형이
-- 10·17배치가 되고, 배치 사이 대기까지 더하면 학습자가 화면 앞에서 몇 분을 기다립니다. 그건
-- 스키마가 아니라 생성 구조를 손봐야 하는 이야기라 선택지에서 뺐습니다.
--
-- 값은 그대로입니다. 문항당 값이고(mig 259), 20문항은 그냥 20문항 값입니다.
BEGIN;

-- 학습자가 **요청한** 길이.
ALTER TABLE public.quiz_sets DROP CONSTRAINT IF EXISTS quiz_sets_requested_count_check;
ALTER TABLE public.quiz_sets
  ADD CONSTRAINT quiz_sets_requested_count_check
  CHECK (requested_count >= 1 AND requested_count <= 20);

-- 한 회차가 **담는** 문항 수. 둘 중 하나만 열면 세트는 만들어지고 회차가 실패합니다.
ALTER TABLE public.quiz_runs DROP CONSTRAINT IF EXISTS quiz_runs_item_count_check;
ALTER TABLE public.quiz_runs
  ADD CONSTRAINT quiz_runs_item_count_check
  CHECK (item_count >= 0 AND item_count <= 20);

COMMIT;
