-- ============================================================================
-- 271 — 광고를 켜기 전에 깔아야 할 계기판, 그리고 돈만 받고 안 주는 사고 막기
--
-- 두 가지를 한다. 둘 다 유료 유입을 받기 전에 반드시 있어야 하는 것들이다.
--
-- ## 1) 안드로이드 지급 경로의 구멍
--
-- Play 프로덕션은 1.0.4(결제 SDK 포함)가 라이브고 구독 상품도 ACTIVE 라, 오늘
-- 누군가 안드로이드에서 $3.99 를 결제할 수 있다. 그런데 활성 SKU 매핑은
-- 'sub_standard_monthly:monthly' 한 형태뿐이다. RevenueCat 이 베이스플랜 접미사
-- 없이 'sub_standard_monthly' 로 보내면 resolve_store_product() 가 완전일치를
-- 요구하므로 NULL 을 돌려주고, 웹훅은 400 을 반환하고, RC 는 재시도를 멈춘다.
-- 결과: 구글은 돈을 받았고 구독은 영원히 지급되지 않는다.
--
-- 접미사 없는 행을 켜서 해결하려 했으나 billing_product_skus 에는
-- '제품당 활성 SKU 하나'(platform, product_id) 유니크 제약이 있다. 그건 지켜야 하는
-- 불변식이다 — 반대 방향 조회(product → store id)가 모호해지면 안 되기 때문이다.
--
-- 그래서 테이블이 아니라 리졸버를 고친다. 베이스플랜 접미사는 같은 상품의 표기 차이일
-- 뿐이므로, 정확일치가 실패하면 ':' 앞부분으로 한 번 더 찾는다. 서로 다른 상품이 같은
-- 베이스 이름을 쓰면 여전히 NULL 이다(기존과 동일하게 모호하면 거절).
--
-- ## 2) 퍼널 이벤트 — 서버에서
--
-- analytics_events 는 59행이고 그중 퍼널 이벤트는 0개다. 광고를 켜면 어디서
-- 새는지 영원히 모른다. 다만 이걸 클라이언트에 꽂지 않는다:
--   • 광고 차단기와 ITP 가 브라우저 이벤트를 먹는다
--   • 웹/모바일 두 벌을 따로 유지해야 하고, 한쪽만 고쳐지면 조용히 어긋난다
--   • 결제 확정은 애초에 웹훅(서버)에서 일어난다 — 결제 탭이 닫혀 있으면 클라이언트는
--     아무것도 못 본다
-- 그래서 전부 트리거로 둔다. 웹이든 iOS 든 안드로이드든 같은 행이 남는다.
--
-- 첫 회만 남겨야 하는 셋(가입/첫 덱/첫 학습)은 부분 유니크 인덱스로 막는다.
-- 결제 둘은 반복될 수 있으므로 인덱스에 넣지 않는다.
--
-- checkout_started 를 payment_intents 의 INSERT 에 거는 이유: create_payment_intent
-- 는 pending 인텐트가 있으면 재사용하고 unique_violation 시에도 기존 행을 돌려준다.
-- INSERT 트리거는 그 두 분기에서 발화하지 않으므로 더블서브밋이 2건으로 잡히지 않는다.
-- ============================================================================

BEGIN;

-- ─── 1) 스토어 상품 매핑: 베이스플랜 접미사를 견디게 ──────────────────────
CREATE OR REPLACE FUNCTION public.resolve_store_product(
  p_platform text, p_store_product_id text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ids text[];
BEGIN
  IF p_store_product_id IS NULL OR p_store_product_id = '' THEN RETURN NULL; END IF;

  -- 1차: 정확일치. 지금까지의 동작 그대로다.
  SELECT array_agg(DISTINCT product_id) INTO v_ids
  FROM billing_product_skus
  WHERE is_active
    AND store_product_id = p_store_product_id
    AND (p_platform IS NULL OR platform = p_platform);

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN
    RETURN v_ids[1];
  END IF;

  -- 2차: 구글 플레이의 베이스플랜 접미사를 떼고 맞춰 본다.
  -- RevenueCat 은 'sub_standard_monthly' 로 보낼 때도 있고
  -- 'sub_standard_monthly:monthly' 로 보낼 때도 있다. 같은 상품이다.
  -- 여전히 둘 이상이 걸리면 NULL — 모호한 매핑으로 지급하지 않는다.
  SELECT array_agg(DISTINCT product_id) INTO v_ids
  FROM billing_product_skus
  WHERE is_active
    AND split_part(store_product_id, ':', 1) = split_part(p_store_product_id, ':', 1)
    AND (p_platform IS NULL OR platform = p_platform);

  IF v_ids IS NULL OR array_length(v_ids, 1) <> 1 THEN
    RETURN NULL;
  END IF;
  RETURN v_ids[1];
END;
$$;

COMMENT ON FUNCTION public.resolve_store_product(text, text) IS
  '스토어 상품 id → 우리 product_id. 정확일치 우선, 실패 시 구글 베이스플랜 접미사(:monthly)를 '
  '떼고 재시도. 모호하면 NULL 을 돌려 잘못된 지급을 막는다.';

-- ─── 2) 퍼널 이벤트 ───────────────────────────────────────────────────────

-- 첫 회만 남길 세 가지. 결제 이벤트는 반복되므로 제외한다.
CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_funnel_once
  ON public.analytics_events (user_id, action)
  WHERE category = 'funnel'
    AND action IN ('signup_completed', 'first_deck_created', 'first_study_started');

-- 이벤트 한 줄을 남기는 내부 헬퍼. 계측이 제품을 죽이면 안 되므로 어떤 실패도
-- 삼킨다 — 이 함수 때문에 덱 생성이나 결제 확정이 롤백되는 일은 없어야 한다.
CREATE OR REPLACE FUNCTION public._record_funnel(
  p_user_id uuid,
  p_action  text,
  p_label   text DEFAULT NULL,
  p_value   numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.analytics_events (user_id, category, action, label, value)
  VALUES (p_user_id, 'funnel', p_action, LEFT(p_label, 200), p_value)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

COMMENT ON FUNCTION public._record_funnel(uuid, text, text, numeric) IS
  '퍼널 이벤트 한 줄. 부분 유니크 인덱스가 첫 회만 남기도록 막고, 어떤 예외도 삼켜서 '
  '계측 실패가 본 작업을 롤백시키지 않게 한다.';

-- 가입 완료: 이메일 인증이 끝나 실제로 쓸 수 있게 된 시점. 소셜 로그인은 INSERT 시점에
-- 이미 email_confirmed_at 이 채워져 들어온다.
CREATE OR REPLACE FUNCTION public._funnel_on_signup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL) THEN
    PERFORM public._record_funnel(NEW.id, 'signup_completed',
      COALESCE(NEW.raw_app_meta_data->>'provider', 'email'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funnel_signup ON auth.users;
CREATE TRIGGER trg_funnel_signup
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._funnel_on_signup();

-- 첫 덱 / 첫 학습: 인덱스가 첫 회만 통과시키므로 트리거는 매번 시도하면 된다.
CREATE OR REPLACE FUNCTION public._funnel_on_deck() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._record_funnel(NEW.user_id, 'first_deck_created', NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funnel_deck ON public.decks;
CREATE TRIGGER trg_funnel_deck
  AFTER INSERT ON public.decks
  FOR EACH ROW EXECUTE FUNCTION public._funnel_on_deck();

CREATE OR REPLACE FUNCTION public._funnel_on_study() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._record_funnel(NEW.user_id, 'first_study_started', NEW.study_mode);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funnel_study ON public.study_sessions;
CREATE TRIGGER trg_funnel_study
  AFTER INSERT ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public._funnel_on_study();

-- 결제: 시작과 완료. 둘 다 반복 가능하므로 유니크 인덱스에 넣지 않았다.
-- 완료는 status 가 'paid' 로 넘어가는 전이에서만 잡는다 — 웹훅이 같은 행을 여러 번
-- 확정 처리해도 이벤트는 한 번만 남는다.
CREATE OR REPLACE FUNCTION public._funnel_on_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._record_funnel(NEW.user_id, 'checkout_started',
      NEW.product_id || ':' || COALESCE(NEW.platform, 'unknown'), NEW.amount_micro_usd);
  ELSIF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM public._record_funnel(NEW.user_id, 'purchase_completed',
      NEW.product_id || ':' || COALESCE(NEW.platform, COALESCE(NEW.provider, 'unknown')),
      NEW.amount_micro_usd);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funnel_intent ON public.payment_intents;
CREATE TRIGGER trg_funnel_intent
  AFTER INSERT OR UPDATE OF status ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public._funnel_on_intent();

-- ─── 3) 광고 귀속 ─────────────────────────────────────────────────────────
--
-- 광고 클릭에서 가입까지는 며칠이 걸린다. 그 사이를 살아남으려면 첫 접점 정보를
-- 붙들고 있다가 계정에 붙여야 한다. 지금은 UTM 을 읽는 순간의 RPC 인자로만 쓰고
-- 버려서, page_views 14,440행의 utm_source 가 전부 NULL 이다.
--
-- 덮어쓰기를 막는 이유: 광고로 처음 들어온 사람이 나중에 검색으로 재방문해서
-- 가입하면, 그 가입은 광고가 만든 것이다. 첫 접점이 이긴다.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attribution jsonb;

COMMENT ON COLUMN public.profiles.attribution IS
  '첫 접점 광고 귀속(utm_*, fbclid, gclid, referrer, landing_path, first_seen_at). '
  '한 번 채워지면 바뀌지 않는다 — 나중 방문이 광고의 공을 가져가지 않도록.';

CREATE OR REPLACE FUNCTION public.set_my_attribution(p_attribution jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_written boolean;
BEGIN
  IF auth.uid() IS NULL OR p_attribution IS NULL
     OR jsonb_typeof(p_attribution) <> 'object' THEN
    RETURN false;
  END IF;
  -- 페이로드가 커지는 걸 막는다. 광고 파라미터는 짧다.
  IF length(p_attribution::text) > 2000 THEN RETURN false; END IF;

  UPDATE public.profiles
     SET attribution = p_attribution
   WHERE id = auth.uid()
     AND attribution IS NULL;   -- write-once
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.set_my_attribution(jsonb) IS
  '내 계정에 첫 접점 귀속을 한 번만 기록한다. 이미 있으면 아무것도 하지 않는다.';

REVOKE EXECUTE ON FUNCTION public.set_my_attribution(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_attribution(jsonb) TO authenticated;

COMMIT;
