-- 268: 파는 한도를 실제로 주고, 앞으로는 숫자만 바꾸면 되게 합니다.
--
-- ── 프로덕션이 정본에서 밀려나 있었습니다 ──────────────────────────────────
--
-- 마이그레이션 139 가 정본입니다: 관리자 무제한 → 살아 있는 구독의 한도 → 무료 한도.
-- 그런데 **프로덕션의 `_owned_card_limit` 은 그 이전 정의**였습니다:
--
--       SELECT max_owned_cards FROM card_limit_settings WHERE id = 1
--
-- 인자를 쓰지 않습니다. 즉 프로덕션에서는 **결제해도 카드 한도가 오르지 않았고**, 관리자도
-- 같은 전역 값에 묶여 있었습니다. 화면은 "5,000장 / 100,000장"을 팔고 있었는데요.
--
-- 139 의 정의를 그대로 다시 겁니다(CREATE OR REPLACE 라 멱등). 새로 쓰지 않는 이유는
-- 그 함수가 이미 촘촘하기 때문입니다 — `grace`/`past_due` 도 인정하되 기간이 살아 있어야
-- 하고, `active` 만 기간 NULL(관리자 컴프)을 허용합니다. 제가 다시 쓰면 그 규칙들을 잃습니다.
--
-- ── 파는 숫자 ──────────────────────────────────────────────────────────────
--
--       무료   1,000 → 5,000
--       플랜   5,000 → 100,000
--
-- 무료를 올려도 오늘 비용은 0입니다: 실사용자 중 가장 많이 가진 사람이 781장이고, 1,000장을
-- 넘는 계정은 공식 콘텐츠 계정 하나뿐입니다. 막히기 전에 불안해지는 지점만 없앱니다.
--
-- ── 다음번엔 SQL 한 줄 ─────────────────────────────────────────────────────
--
--       무료:            UPDATE card_limit_settings SET max_owned_cards = <N> WHERE id = 1;
--       새 판매분만:      UPDATE billing_products SET card_limit = <N> WHERE id = 'sub_5k_monthly';
--       기존 구독자까지:  SELECT set_plan_card_limit('sub_5k_monthly', <N>);
--
-- 배포도 심사도 필요 없습니다. 마지막 함수가 상품과 **살아 있는 구독**을 함께 올려, 값을
-- 올릴 때 기존 고객만 옛 한도에 갇히는 일이 없게 합니다.
BEGIN;

-- ── 1) 정본 복원 (139 그대로) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    -- Admins are never capped anywhere (mirror check_card_limit / the mig-136 trigger).
    WHEN EXISTS (SELECT 1 FROM profiles WHERE id = p_owner AND role = 'admin')
      THEN 2000000000
    ELSE COALESCE(
      (SELECT s.card_limit FROM billing_subscriptions s
         WHERE s.user_id = p_owner
           AND s.status IN ('active','canceled','grace','past_due')
           AND s.card_limit IS NOT NULL
           AND (
             (s.status = 'active'
                AND (s.current_period_end IS NULL OR s.current_period_end > now()))
             OR (s.status <> 'active'
                AND s.current_period_end IS NOT NULL
                AND s.current_period_end > now())
           )
         ORDER BY s.card_limit DESC LIMIT 1),
      (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1))
  END;
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) 파는 숫자 ────────────────────────────────────────────────────────────
UPDATE public.card_limit_settings SET max_owned_cards = 5000, updated_at = now() WHERE id = 1;

UPDATE public.billing_products SET card_limit = 100000 WHERE id = 'sub_5k_monthly';

-- 이미 산 사람도 함께. 하나뿐인 플랜의 숫자를 올리면서 기존 고객만 5,000 에 남겨 두는 것은
-- 팔지 않은 차별입니다.
UPDATE public.billing_subscriptions
   SET card_limit = 100000, updated_at = now()
 WHERE product_id = 'sub_5k_monthly' AND status IN ('active', 'trialing', 'grace', 'past_due');

-- ── 3) 다음번엔 한 번 부르면 되게 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_plan_card_limit(
  p_product_id text,
  p_limit      integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_subs integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'card limit must be positive' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE billing_products SET card_limit = p_limit WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  -- 살아 있는 구독만. 끝난 구독의 스냅샷은 그때 판 것이라 그대로 둡니다.
  UPDATE billing_subscriptions SET card_limit = p_limit, updated_at = now()
   WHERE product_id = p_product_id
     AND status IN ('active', 'trialing', 'grace', 'past_due');
  GET DIAGNOSTICS v_subs = ROW_COUNT;

  RETURN jsonb_build_object('product', p_product_id, 'limit', p_limit,
                            'subscriptions_updated', v_subs);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.set_plan_card_limit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_plan_card_limit(text, integer) TO service_role;

COMMENT ON FUNCTION public.set_plan_card_limit(text, integer) IS
  '플랜 카드 한도를 바꿉니다. 상품과 살아 있는 구독을 함께 올려, 기존 고객만 옛 한도에 갇히지 않게 합니다.';

COMMIT;
