-- 269: 덱·템플릿·세션 한도가 클라이언트 코드에만 있었습니다.
--
-- `tier-config.ts` 에 이렇게 적혀 있었습니다:
--
--       free   decks_total 5 · templates_total 20 · study_sessions_daily 100
--       pro    decks_total 500 · templates_total 100
--
-- 그런데 **서버는 셋 다 막지 않습니다.** 프로덕션에서 잰 실제 사용량:
--
--       덱      649 · 32 · 5 · 3 · 2
--       템플릿  8 · 6 · 6 · 4 · 4
--
-- 무료 한도가 5인데 32개를 가진 계정이 있습니다. 숫자가 유명무실했다는 뜻이고, 두 가지가
-- 동시에 문제입니다: **바꾸려면 배포가 필요하고, REST 를 직접 부르면 그냥 뚫립니다.**
--
-- ── 무엇을 하는가 ──────────────────────────────────────────────────────────
--
-- 1. 한도를 표로 옮깁니다(`plan_entitlements`). 티어 x 자원 → 값.
-- 2. 덱·템플릿은 **서버가 막습니다**(BEFORE INSERT 트리거). 둘 다 REST 직접 insert 로
--    만들어지므로 트리거가 유일하게 확실한 자리입니다 — 카드가 mig 136 에서 택한 방식과 같습니다.
-- 3. 클라이언트가 한 번에 읽을 창구를 냅니다(`get_my_entitlements`).
--
-- ── 카드는 왜 이 표에 안 넣는가 ────────────────────────────────────────────
--
-- 카드 한도는 **구독 시점 스냅샷**입니다(`billing_subscriptions.card_limit`). 값을 올려도
-- 이미 산 사람은 산 것을 유지하고, `set_plan_card_limit` 이 원할 때만 함께 올립니다. 티어당
-- 한 값인 평평한 표로는 그 의미를 담을 수 없습니다. 그래서 카드는 지금 자리에 두고,
-- `get_my_entitlements` 가 둘을 합쳐 **클라이언트에게는 한 창구**로 보여 줍니다.
--
-- ── 값을 바꾸는 법 ─────────────────────────────────────────────────────────
--
--       UPDATE plan_entitlements SET value = <N> WHERE tier = 'free' AND resource = 'decks_total';
--
-- 배포도 심사도 필요 없습니다.
BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  tier       text    NOT NULL,
  resource   text    NOT NULL,
  value      bigint  NOT NULL CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tier, resource)
);

COMMENT ON TABLE public.plan_entitlements IS
  '티어별 한도. 값을 바꾸는 데 배포가 필요 없게 하려고 코드에서 옮겨 온 표입니다. 카드 한도는 구독 스냅샷 의미가 있어 여기 있지 않습니다 — get_my_entitlements 가 합쳐서 보여 줍니다.';

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
-- 읽기는 누구나(요금제 안내에 쓰입니다). 쓰기는 서비스 롤/관리자만.
DROP POLICY IF EXISTS "Anyone can read entitlements" ON public.plan_entitlements;
CREATE POLICY "Anyone can read entitlements" ON public.plan_entitlements FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.plan_entitlements FROM authenticated, anon;

-- 실제 사용량을 보고 정한 값입니다. 지금 쓰는 사람을 막지 않으면서, 이상한 자동화는 걸립니다.
INSERT INTO public.plan_entitlements (tier, resource, value) VALUES
  ('free',     'decks_total',          100),
  ('free',     'templates_total',       50),
  ('free',     'study_sessions_daily', 500),
  ('plan_5k',  'decks_total',         2000),
  ('plan_5k',  'templates_total',      500),
  ('plan_5k',  'study_sessions_daily', 5000)
ON CONFLICT (tier, resource) DO NOTHING;

-- ── 티어 판정 ───────────────────────────────────────────────────────────────
--
-- 카드 한도가 쓰는 규칙과 같아야 합니다(mig 139): 살아 있는 구독이면 그 티어, 아니면 free.
CREATE OR REPLACE FUNCTION public._effective_tier(p_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.tier::text FROM billing_subscriptions s
      WHERE s.user_id = p_owner
        AND s.status IN ('active','canceled','grace','past_due')
        AND (
          (s.status = 'active'
             AND (s.current_period_end IS NULL OR s.current_period_end > now()))
          OR (s.status <> 'active'
             AND s.current_period_end IS NOT NULL
             AND s.current_period_end > now())
        )
      ORDER BY s.current_period_end DESC NULLS FIRST LIMIT 1),
    'free');
$$;

CREATE OR REPLACE FUNCTION public._entitlement(p_owner uuid, p_resource text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    -- 관리자는 어디서도 막히지 않습니다(카드와 같은 규칙).
    WHEN EXISTS (SELECT 1 FROM profiles WHERE id = p_owner AND role = 'admin')
      THEN 2000000000::bigint
    ELSE COALESCE(
      (SELECT e.value FROM plan_entitlements e
        WHERE e.tier = public._effective_tier(p_owner) AND e.resource = p_resource),
      (SELECT e.value FROM plan_entitlements e
        WHERE e.tier = 'free' AND e.resource = p_resource),
      -- 표에 없는 자원은 막지 않습니다. 모르는 것을 이유로 사용자를 세우지 않습니다.
      2000000000::bigint)
  END;
$$;

-- ── 덱·템플릿은 서버가 막는다 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enforce_row_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner uuid := NEW.user_id;
  v_limit bigint;
  v_owned bigint;
  v_resource text := TG_ARGV[0];
BEGIN
  IF v_owner IS NULL THEN RETURN NEW; END IF;
  -- 서비스 롤은 통과합니다. 공식 콘텐츠 시딩·복구 스크립트가 여기서 막히면 안 됩니다.
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  v_limit := public._entitlement(v_owner, v_resource);
  IF v_limit >= 1000000000 THEN RETURN NEW; END IF;

  EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', TG_TABLE_NAME)
    INTO v_owned USING v_owner;

  IF v_owned + 1 > v_limit THEN
    RAISE EXCEPTION 'row_limit_reached'
      USING errcode = 'PT402',
            hint    = 'ROW_LIMIT_REACHED',
            detail  = format('resource=%s owned=%s limit=%s', v_resource, v_owned, v_limit);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deck_limit ON public.decks;
CREATE TRIGGER trg_deck_limit BEFORE INSERT ON public.decks
  FOR EACH ROW EXECUTE FUNCTION public._enforce_row_limit('decks_total');

DROP TRIGGER IF EXISTS trg_template_limit ON public.card_templates;
CREATE TRIGGER trg_template_limit BEFORE INSERT ON public.card_templates
  FOR EACH ROW EXECUTE FUNCTION public._enforce_row_limit('templates_total');

-- ── 클라이언트가 읽는 한 창구 ───────────────────────────────────────────────
--
-- 화면마다 티어를 따로 읽고 한도를 따로 적던 것을 여기로 모읍니다. 광고를 붙일 때도
-- `ads_free` 를 여기서 읽으면 되고, 그건 **스키마 변경 없이** 오늘 이미 나갑니다.
CREATE OR REPLACE FUNCTION public.get_my_entitlements()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tier',                  public._effective_tier(auth.uid()),
    'is_paid',               public._effective_tier(auth.uid()) <> 'free',
    -- 광고 없음 = 유료. 지금은 광고가 없지만, 붙일 때 클라이언트가 읽을 자리를 미리 둡니다.
    'ads_free',              public._effective_tier(auth.uid()) <> 'free',
    -- 카드는 구독 스냅샷이라 표가 아니라 그쪽에서 옵니다(위 헤더 참고).
    'cards_total',           public._owned_card_limit(auth.uid()),
    'decks_total',           public._entitlement(auth.uid(), 'decks_total'),
    'templates_total',       public._entitlement(auth.uid(), 'templates_total'),
    'study_sessions_daily',  public._entitlement(auth.uid(), 'study_sessions_daily'),
    'free_ai_cards_per_day', (SELECT per_day FROM ai_free_allowances
                               WHERE tier = 'free' AND action_group = 'card')
  ) WHERE auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_entitlements() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_entitlements() TO authenticated;

COMMIT;
