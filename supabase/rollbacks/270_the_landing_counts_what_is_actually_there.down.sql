-- 270 되돌리기: 랜딩이 셀 숫자가 없던 상태로.
--
-- 되돌리면 랜딩의 수치 섹션은 아무것도 렌더하지 않습니다(컴포넌트가 RPC 실패 시
-- null 을 그대로 두고 섹션을 숨깁니다). 지어낸 값으로 되돌아가지는 않습니다.
BEGIN;
DROP FUNCTION IF EXISTS public.get_public_stats();
DROP TABLE IF EXISTS public.public_stats_snapshot;
COMMIT;
