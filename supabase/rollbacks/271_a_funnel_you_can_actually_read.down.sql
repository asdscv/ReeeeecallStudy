-- 271 되돌리기: 계기판이 없던 상태로. 안드로이드 SKU 도 원래대로 끈다.
--
-- 주의: 리졸버를 되돌리면 RevenueCat 이 베이스플랜 없는 형태로 보낼 때 다시
-- '돈만 받고 지급 안 됨' 상태가 된다. 되돌릴 이유가 정말 있는지 확인할 것.
BEGIN;
DROP TRIGGER IF EXISTS trg_funnel_intent ON public.payment_intents;
DROP TRIGGER IF EXISTS trg_funnel_study ON public.study_sessions;
DROP TRIGGER IF EXISTS trg_funnel_deck ON public.decks;
DROP TRIGGER IF EXISTS trg_funnel_signup ON auth.users;
DROP FUNCTION IF EXISTS public._funnel_on_intent();
DROP FUNCTION IF EXISTS public._funnel_on_study();
DROP FUNCTION IF EXISTS public._funnel_on_deck();
DROP FUNCTION IF EXISTS public._funnel_on_signup();
DROP FUNCTION IF EXISTS public._record_funnel(uuid, text, text, numeric);
DROP INDEX IF EXISTS public.analytics_events_funnel_once;
DROP FUNCTION IF EXISTS public.set_my_attribution(jsonb);
ALTER TABLE public.profiles DROP COLUMN IF EXISTS attribution;
-- resolve_store_product 를 정확일치 전용으로 되돌린다.
CREATE OR REPLACE FUNCTION public.resolve_store_product(
  p_platform text, p_store_product_id text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ids text[];
BEGIN
  IF p_store_product_id IS NULL OR p_store_product_id = '' THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT product_id) INTO v_ids
  FROM billing_product_skus
  WHERE is_active AND store_product_id = p_store_product_id
    AND (p_platform IS NULL OR platform = p_platform);
  IF v_ids IS NULL OR array_length(v_ids, 1) <> 1 THEN RETURN NULL; END IF;
  RETURN v_ids[1];
END;
$$;
COMMIT;
