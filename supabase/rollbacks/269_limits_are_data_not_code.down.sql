-- 269 되돌리기: 서버가 덱·템플릿을 막지 않던 상태로.
--
-- 되돌리면 한도는 다시 클라이언트 코드에만 남습니다(REST 직접 호출로 뚫림).
BEGIN;
DROP TRIGGER IF EXISTS trg_deck_limit ON public.decks;
DROP TRIGGER IF EXISTS trg_template_limit ON public.card_templates;
DROP FUNCTION IF EXISTS public._enforce_row_limit();
DROP FUNCTION IF EXISTS public.get_my_entitlements();
DROP FUNCTION IF EXISTS public._entitlement(uuid, text);
DROP FUNCTION IF EXISTS public._effective_tier(uuid);
DROP TABLE IF EXISTS public.plan_entitlements;
COMMIT;
