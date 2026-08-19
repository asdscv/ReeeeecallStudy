-- 267 되돌리기: Pro 를 다시 판매합니다.
BEGIN;
UPDATE public.billing_products SET is_active = true WHERE id = 'sub_unlimited_monthly';
COMMIT;
