-- 268 되돌리기: 한도를 다시 전역 하나로 돌립니다.
--
-- 되돌리면 **돈을 내도 카드 한도가 안 올라갑니다.** 무료 한도도 1,000 으로 돌아갑니다.
BEGIN;

CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT max_owned_cards FROM card_limit_settings WHERE id = 1 $$;

UPDATE public.card_limit_settings SET max_owned_cards = 1000, updated_at = now() WHERE id = 1;
UPDATE public.billing_products SET card_limit = 5000 WHERE id = 'sub_5k_monthly';

DROP FUNCTION IF EXISTS public.set_plan_card_limit(text, integer);

COMMIT;
