-- 272 되돌리기: 재사용 창을 다시 없앤다.
--
-- 주의: 되돌리면 오래된 pending 인텐트가 다시 새 결제에 물립니다. 2026-08-21 에
-- 안드로이드 첫 결제가 지급되지 않은 원인이 정확히 그것이었습니다.
-- 만료로 바꾼 행들은 되돌리지 않습니다 — 그 행들은 어떤 결제와도 연결된 적이 없습니다.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_payment_intent(p_product_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Rollback stub — restore the pre-272 body from migration history'
    USING errcode = 'feature_not_supported';
END;
$$;
COMMIT;
