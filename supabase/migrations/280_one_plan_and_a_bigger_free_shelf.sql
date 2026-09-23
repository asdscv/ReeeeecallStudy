-- 280: 플랜은 하나만 남기고, 무료 선반을 두 배로 늘립니다.
--
-- 소유자 결정입니다. 두 가지를 합니다.
--
--   1) Pro(`sub_unlimited_monthly`)를 **행째로 지웁니다.**
--   2) 무료 기본 카드 한도를 **5,000 → 10,000** 으로 올립니다.
--
-- ── 1) 왜 이번엔 끄지 않고 지우는가 ─────────────────────────────────────────
--
-- 267 이 Pro 를 `is_active = false` 로 껐고, 지우지 않은 이유를 이렇게 적어 뒀습니다:
-- *"행을 지우면 결제 이력이 가리키는 상품이 없어져서, 나중에 '이 사람이 무엇을 샀는가'를
-- 되짚을 수 없습니다."* 옳은 원칙이고, 팔린 적이 있었다면 지금도 지키는 게 맞습니다.
--
-- 그런데 팔린 적이 없습니다. 지우기 전에 확인했습니다:
--
-- `billing_products` 를 참조하는 외래키를 **전수로** 뽑아 하나씩 봤습니다. (처음에는
-- 테이블 이름을 짐작해서 다섯 개만 확인했고, 그래서 `billing_product_skus` 를 놓쳐
-- 로컬 적용이 외래키 위반으로 실패했습니다. 짐작 대신 pg_constraint 를 읽어야 합니다.)
--
--   billing_subscriptions  product_id='sub_unlimited_monthly'  → 0행
--   payment_intents        product_id='sub_unlimited_monthly'  → 0행
--   billing_invoices       product_id='sub_unlimited_monthly'  → 0행
--   billing_consents       product_id='sub_unlimited_monthly'  → 0행
--   billing_product_skus   product_id='sub_unlimited_monthly'  → **7행** ← 스토어 매핑
--   ai_free_allowances     tier='plan_unlimited'               → 0행
--   plan_entitlements      tier='plan_unlimited'               → 0행
--
-- 보존할 **구매 이력**은 없습니다. 남은 7행은 이력이 아니라 스토어 상품 id 매핑입니다.
--
-- ── 스토어에서 정말 살 수 없는가 (지우기 전에 확인) ────────────────────────
--
-- 카탈로그에서만 지우고 스토어에 상품이 살아 있으면, 결제는 되는데 줄 것이 없는 상태가
-- 됩니다. 이 검증 전체가 바로 그런 구멍을 찾으려던 것이므로 직접 확인했습니다:
--
--   App Store Connect  구독 그룹 22206070 → `standard_monthly` **하나뿐**.
--                      `pro_monthly` 는 상품 자체가 존재하지 않습니다.
--   Google Play        `sub_pro_monthly`      → base plan monthly = **INACTIVE**
--                      `sub_standard_monthly` → base plan monthly = ACTIVE
--   LemonSqueezy       variant 매핑은 이 마이그레이션과 함께 `.env.production` 에서 뺍니다.
--
-- 어느 스토어에서도 Pro 를 새로 구매할 수 없으므로 매핑 7행은 죽은 배선입니다.
--
-- ── 그래서 왜 굳이 지우는가 ────────────────────────────────────────────────
--
-- 남겨 두면 **되살아날 수 있기** 때문입니다. 검증에서 찾은 F-3 이 정확히 그 얘기였습니다:
-- Pro 는 $19.99 인데 카드 한도가 Standard($3.99)와 똑같은 100,000 이라, `is_active` 만
-- 켜면 5배를 받고 더 주는 게 없는 상품이 그대로 나갑니다. **끄는 것과 없애는 것은
-- 다릅니다.**
--
-- 안전망은 그대로 둡니다: 하네스의 L0 검사가 "판매 중인 플랜 중 값만 비싸고 더 주지 않는
-- 것"을 계속 감시합니다.
--
-- ── 2) 무료 5,000 → 10,000 ─────────────────────────────────────────────────
--
-- 무료 한도는 이 표 한 행에서 나와 `_owned_card_limit` → `get_owned_card_usage` → 화면까지
-- 흐릅니다. 코드나 문구에 박혀 있지 않으므로 이 UPDATE 하나로 웹·모바일 모든 화면의
-- "N / 5,000" 이 "N / 10,000" 으로 바뀝니다.
--
-- 아무도 한도를 잃지 않습니다 — 올리는 방향이고, 현재 가장 많이 가진 실사용자도 1,000장
-- 아래입니다(공식 콘텐츠 계정은 관리자 센티넬이라 애초에 무제한).
--
-- 유료 전환 유인: 무료 10,000 대 Standard 100,000 = 10배.

BEGIN;

-- 1) Pro 제거. 스토어 매핑(자식)을 먼저 지우고 상품(부모)을 지웁니다 — 외래키 순서.
DELETE FROM public.billing_product_skus
 WHERE product_id = 'sub_unlimited_monthly';

DELETE FROM public.billing_products
 WHERE id = 'sub_unlimited_monthly';

-- 2) 무료 기본 한도 상향.
UPDATE public.card_limit_settings
   SET max_owned_cards = 10000,
       updated_at      = now()
 WHERE id = 1
   AND max_owned_cards = 5000;   -- 이전 값 가드: 두 번 적용돼도 안전하고, 이미 다른 값이면 건드리지 않습니다

COMMIT;
