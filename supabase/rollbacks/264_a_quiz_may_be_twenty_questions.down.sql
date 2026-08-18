-- 264 되돌리기: 길이를 12 로 되돌립니다.
--
-- 되돌리기 전에 20 을 넘는 세트·회차가 없어야 합니다. 남아 있으면 ADD CONSTRAINT 가 실패합니다
-- (그리고 실패하는 편이 맞습니다 — 이미 만들어진 퀴즈를 못 열게 만드는 것보다 낫습니다).
BEGIN;

ALTER TABLE public.quiz_sets DROP CONSTRAINT IF EXISTS quiz_sets_requested_count_check;
ALTER TABLE public.quiz_sets
  ADD CONSTRAINT quiz_sets_requested_count_check
  CHECK (requested_count >= 1 AND requested_count <= 12);

ALTER TABLE public.quiz_runs DROP CONSTRAINT IF EXISTS quiz_runs_item_count_check;
ALTER TABLE public.quiz_runs
  ADD CONSTRAINT quiz_runs_item_count_check
  CHECK (item_count >= 0 AND item_count <= 12);

COMMIT;
