-- 288 되돌리기: 두뇌 기록 클라우드 저장을 없앱니다.
-- 모든 계정의 클라우드 사본(progress·history·meta)이 지워집니다. 기기 사본(localStorage·SecureStore)은
-- 그대로이고, 클라이언트는 함수·표가 없으면(PGRST202/42883/42P01/404) 기기 전용으로 조용히 돌아갑니다 —
-- 다시 올리면 각 기기의 사본이 첫 동기화 때 다시 올라갑니다.
BEGIN;

DROP FUNCTION IF EXISTS public.save_brain_progress(uuid, integer, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.save_brain_progress(uuid, integer, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.get_my_brain_save();
DROP TABLE IF EXISTS public.brain_saves;

NOTIFY pgrst, 'reload schema';

COMMIT;
