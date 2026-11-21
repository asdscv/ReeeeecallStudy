-- 순차·랜덤·날짜별 학습의 웹과 앱은 카드마다 '알아요/몰라요'를 보냅니다.
-- 로컬 브라우저에서 순차 학습 3장을 완료했지만 RPC가 known을 거절해
-- study_logs와 완료 세션의 카드 수가 모두 0이었습니다.
-- 세 모드의 로그 전용 계약에 known/unknown을 추가합니다. 기존 next 요청과
-- SRS 검증, 접근 판정, 멱등 처리, 커서 갱신은 같은 함수에서 처리합니다.
BEGIN;

DO $migration$
DECLARE
  definition text := pg_get_functiondef(
    'public._apply_study_rating_core(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)'::regprocedure);
  old_check constant text := $check$(p_study_mode IN ('random','sequential','by_date') AND p_rating <> 'next')$check$;
  new_check constant text := $check$(p_study_mode IN ('random','sequential','by_date') AND p_rating NOT IN ('next','known','unknown'))$check$;
BEGIN
  IF strpos(definition, new_check) > 0 THEN
    RETURN;
  END IF;
  IF strpos(definition, old_check) = 0 THEN
    RAISE EXCEPTION 'Expected log-only study rating validation is missing';
  END IF;
  EXECUTE replace(definition, old_check, new_check);
END;
$migration$;

COMMIT;
