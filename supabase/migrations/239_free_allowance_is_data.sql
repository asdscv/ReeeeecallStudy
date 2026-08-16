-- 239: 무료 정책을 코드에서 데이터로.
--
-- 요청: 무료 티어에게 하루 카드 10장, 퀴즈 5문항 — **유형 상관없이**.
--
-- 두 번째 조건이 지금 구조로는 표현이 안 됩니다. 무료 배분이 전부 "유닛"이고 유닛은 유형마다
-- 다르기 때문입니다(객관식·주관식 2, 서술형 3). 하루 10유닛은 객관식 5문항이거나 서술형
-- 3문항이라, 어떤 숫자를 넣어도 "유형 상관없이 5개"가 되지 않습니다.
--
-- 그리고 지금 무료 정책은 세 군데에 흩어져 있습니다:
--
--   ai_pricing_settings.free_cards_per_day        전역 숫자 하나
--   ai_pricing_settings.free_quiz_units_per_day   전역 숫자 하나
--   reserve_ai_quiz / get_ai_quiz_quote 안의       `IF p_action LIKE 'grade\_%'` 하드코딩
--                                                  (233이 "채점은 무료 없음"을 코드로 박음)
--
-- 티어를 하나 추가하거나, 채점에 무료를 한 건 주거나, 카드만 늘리려면 전부 배포가 필요합니다.
-- 이 레포는 이미 반대 방식을 알고 있습니다 — 난이도 밴드는 테이블이고, 밴드를 100개로 늘리는
-- 데 INSERT 한 줄이면 됩니다(`quiz_difficulty_test.sql`의 첫 문단이 그 요구사항입니다).
--
-- ── 커널 ────────────────────────────────────────────────────────────────────
--
--   ai_free_allowances(tier, action_group)  →  per_day, unit_kind, trial_applies
--   _ai_free_allowance(user, action_group)  →  그 사용자에게 적용되는 한 행
--
-- 호출부는 숫자를 모릅니다. 티어도 모릅니다. "이 사용자에게 이 행동은 하루 몇 개까지
-- 공짜인가"만 묻습니다. 그래서:
--
--   * 무료 문항 5 → 8로:            UPDATE 한 줄
--   * 유료 티어에 20문항 주기:       INSERT 한 줄
--   * 채점에 하루 1건 무료 주기:     UPDATE 한 줄 (233의 하드코딩이 이 테이블의 0으로 바뀜)
--   * 가중치 방식으로 되돌리기:      unit_kind = 'unit'
--
-- `unit_kind`가 두 값을 갖는 이유가 그 마지막 줄입니다. 'item'은 "카드 한 장 / 문항 하나,
-- 값이 얼마든"이고 'unit'은 예전의 가중치 유닛입니다. 둘 다 배분 코드에 있으므로 어느 쪽이든
-- 데이터로 고를 수 있습니다.
BEGIN;

-- ── 1. 정책 테이블 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_free_allowances (
  -- `subscriptions.tier`와 같은 값. 'free'는 폴백이자 무료 티어입니다.
  tier          text        NOT NULL,
  -- 'card' | 'quiz_generate' | 'quiz_grade' | 'image' | 'remediation'
  -- 열거형이 아니라 text입니다: 새 AI 행동이 생겼을 때 타입 변경 없이 행만 추가하면 됩니다.
  action_group  text        NOT NULL,
  per_day       integer     NOT NULL CHECK (per_day >= 0),
  -- 'item': 카드 한 장 / 문항 하나, 유형과 무관     ← 요청하신 방식
  -- 'unit': 유형 가중치가 붙은 예전 유닛
  unit_kind     text        NOT NULL DEFAULT 'item' CHECK (unit_kind IN ('item', 'unit')),
  -- 일회성 체험 유닛(`ai_quiz_trial`)이 이 행동에 쓰이는지. 233이 "채점에는 체험도 안 준다"를
  -- 코드로 박았던 부분이 여기로 옵니다.
  trial_applies boolean     NOT NULL DEFAULT false,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tier, action_group)
);

ALTER TABLE public.ai_free_allowances ENABLE ROW LEVEL SECURITY;
-- 읽기는 SECURITY DEFINER 리졸버를 통해서만. 정책은 사용자가 볼 이유가 없고, 볼 수 있으면
-- 티어별 한도가 그대로 노출됩니다.
REVOKE ALL ON public.ai_free_allowances FROM PUBLIC, anon, authenticated;

INSERT INTO public.ai_free_allowances (tier, action_group, per_day, unit_kind, trial_applies, note) VALUES
  ('free', 'card',          10, 'item', false,
   '하루 카드 10장. 한 번에 20장을 만들면 10장은 무료, 10장은 과금.'),
  ('free', 'quiz_generate',  5, 'item', true,
   '하루 문항 5개, 유형 무관. 예전에는 10유닛이라 객관식 5문항 / 서술형 3문항이었습니다.'),
  ('free', 'quiz_grade',     0, 'item', false,
   '채점은 첫 건부터 유료(mig 233). 매 답안마다 모델을 부르는 행동에 무료를 주면 무한 보조금.'),
  ('free', 'image',          0, 'item', false,
   '이미지는 mig 230부터 정가 과금.'),
  ('free', 'remediation',    0, 'item', false,
   'AI 해설은 정가 과금.')
ON CONFLICT (tier, action_group) DO NOTHING;

-- ── 2. 리졸버 ───────────────────────────────────────────────────────────────
/**
 * 이 사용자에게 이 행동이 하루 몇 개까지 공짜인가.
 *
 * 티어 → 정확히 일치하는 행 → 없으면 'free' 행 → 그것도 없으면 (0, 'item').
 * 마지막 폴백이 0인 것은 의도입니다: 테이블에 없는 행동은 **무료가 아닙니다**. 새 AI 기능을
 * 붙이면서 정책 행을 깜빡했을 때 조용히 공짜가 되는 쪽이 훨씬 비쌉니다.
 */
CREATE OR REPLACE FUNCTION public._ai_free_allowance(p_user uuid, p_action_group text)
  RETURNS TABLE (per_day integer, unit_kind text, trial_applies boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tier text;
BEGIN
  SELECT s.tier INTO v_tier
    FROM subscriptions s
   WHERE s.user_id = p_user
     AND s.status = 'active'
     AND (s.expires_at IS NULL OR s.expires_at > now())
   ORDER BY s.started_at DESC
   LIMIT 1;
  v_tier := COALESCE(v_tier, 'free');

  RETURN QUERY
    SELECT a.per_day, a.unit_kind, a.trial_applies
      FROM ai_free_allowances a
     WHERE a.action_group = p_action_group AND a.tier = v_tier;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT a.per_day, a.unit_kind, a.trial_applies
      FROM ai_free_allowances a
     WHERE a.action_group = p_action_group AND a.tier = 'free';
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT 0, 'item'::text, false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._ai_free_allowance(uuid, text) FROM PUBLIC, anon, authenticated;

-- 기존 심은 그대로 둡니다. 호출부(`reserve_ai_generation`, `get_ai_generation_quota`)는
-- 이 함수만 알고 있고, 바뀐 것은 이 함수가 숫자를 어디서 읽느냐입니다.
CREATE OR REPLACE FUNCTION public._ai_free_cards_per_day()
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT per_day FROM public._ai_free_allowance(auth.uid(), 'card')), 0);
$$;

-- 관리자 설정도 같은 테이블을 씁니다. 시그니처는 그대로라 어드민 화면은 모릅니다.
CREATE OR REPLACE FUNCTION public.admin_set_ai_free_quota(p_free_cards_per_day integer)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_free_cards_per_day IS NULL OR p_free_cards_per_day < 0 OR p_free_cards_per_day > 100000 THEN
    RAISE EXCEPTION 'free_cards_per_day out of range (0..100000)' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE public.ai_free_allowances
     SET per_day = p_free_cards_per_day, updated_at = now()
   WHERE tier = 'free' AND action_group = 'card';
  -- 예전 컬럼도 맞춰 둡니다. 읽는 곳은 없지만, 남겨두고 안 맞으면 다음 사람이 그걸 믿습니다.
  UPDATE public.ai_pricing_settings SET free_cards_per_day = p_free_cards_per_day, updated_at = now()
   WHERE id = 1;
  RETURN p_free_cards_per_day;
END;
$$;

-- ── 3. 문항 단위 배분 ───────────────────────────────────────────────────────
ALTER TABLE public.ai_generation_usage
  ADD COLUMN IF NOT EXISTS free_quiz_items_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS quiz_free_items_held  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_trial_items_held integer NOT NULL DEFAULT 0;

/**
 * 문항 단위 배분. 체험 → 무료 → 유료 순서는 유닛 배분과 같습니다.
 *
 * 체험은 여전히 유닛으로 남아 있으므로(`ai_quiz_trial.units_remaining`) 문항으로 환산할 때
 * 내림합니다. 반 문항짜리 체험은 존재할 수 없고, 남은 반 유닛은 다음 호출에서 다시 계산됩니다.
 */
CREATE OR REPLACE FUNCTION public._ai_quiz_allocate_items(
  p_items integer, p_units_each integer, p_trial_units_left integer, p_free_items_left integer,
  OUT trial_items integer, OUT free_items integer, OUT paid_items integer)
  RETURNS record
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT t, f, GREATEST(0, GREATEST(p_items, 0) - t - f)
  FROM (SELECT LEAST(GREATEST(p_items, 0),
                     GREATEST(p_trial_units_left, 0) / GREATEST(p_units_each, 1)) AS t) a,
       LATERAL (SELECT LEAST(GREATEST(p_items, 0) - a.t, GREATEST(p_free_items_left, 0)) AS f) b;
$$;

COMMIT;

-- ── 4. reserve_ai_quiz — 정책을 읽고, 문항으로 배분 ─────────────────────────
--
-- 233이 코드에 박아둔 `IF p_action LIKE 'grade\_%'`가 사라집니다. 채점이 무료가 아닌 것은
-- 이제 `ai_free_allowances`의 ('free','quiz_grade', per_day 0, trial_applies false) 한 행이고,
-- 언젠가 채점에 하루 한 건을 주기로 하면 UPDATE 한 줄입니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_ai_quiz(p_action text, p_count integer, p_client_ref uuid, p_max_price_micro bigint, p_deck_id uuid DEFAULT NULL::uuid, p_card_ids uuid[] DEFAULT '{}'::uuid[], p_set_id uuid DEFAULT NULL::uuid, p_run_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_ref        text := gen_random_uuid()::text;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_job_kind   text;
  v_total      integer;
  v_trial_left integer := 0;
  v_free_used  integer := 0;
  v_free_items_used integer := 0;
  v_free_left  integer;
  v_allow      record;
  v_items      record;
  v_alloc      record;
  v_price      bigint;
  v_balance    bigint := 0;
  v_held       bigint := 0;
  v_requests   integer;
  v_existing   ai_generation_jobs%ROWTYPE;
  v_card       uuid;
  v_stale      record;
  c_max_requests constant integer := 300;
  c_stale_after  constant interval := '30 minutes';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_client_ref IS NULL OR p_max_price_micro IS NULL OR p_max_price_micro < 0 THEN
    RAISE EXCEPTION 'client_ref and max_price are required'
      USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT units, job_kind INTO v_units_each, v_job_kind
    FROM ai_quiz_price_units WHERE action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;

  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be positive' USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_job_kind = 'quiz_grade' AND p_count <> 1 THEN
    RAISE EXCEPTION 'grading reserves one answer at a time' USING errcode = 'invalid_parameter_value';
  END IF;
  v_total := v_units_each * p_count;
  IF v_total > s.quiz_max_units_per_call THEN
    RAISE EXCEPTION 'Quiz request too large' USING errcode = 'P0009';
  END IF;

  IF p_deck_id IS NOT NULL AND NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF cardinality(COALESCE(p_card_ids, '{}'::uuid[])) > 50 THEN
    RAISE EXCEPTION 'Too many cards' USING errcode = 'P0009';
  END IF;
  FOREACH v_card IN ARRAY COALESCE(p_card_ids, '{}'::uuid[]) LOOP
    IF NOT public._check_card_access(v_uid, v_card) THEN
      RAISE EXCEPTION 'Card not accessible' USING errcode = '42501';
    END IF;
  END LOOP;
  IF p_set_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501';
  END IF;
  IF p_run_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quiz_run_items i JOIN quiz_runs r ON r.id = i.run_id
     WHERE i.id = p_run_item_id AND r.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Quiz run item not accessible' USING errcode = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_client_ref::text, 0));
  SELECT * INTO v_existing FROM ai_generation_jobs
   WHERE user_id = v_uid AND client_ref = p_client_ref;
  IF FOUND THEN
    IF v_existing.quiz_action IS DISTINCT FROM p_action
       OR v_existing.quiz_units_held IS DISTINCT FROM v_total THEN
      RAISE EXCEPTION 'client_ref reused with different parameters'
        USING errcode = 'invalid_parameter_value';
    END IF;
    RETURN jsonb_build_object('job_ref', v_existing.id, 'job_kind', v_existing.job_kind,
                              'units', v_existing.quiz_units_held,
                              'paid_units', v_existing.quiz_units_held - v_existing.quiz_free_held
                                            - v_existing.quiz_trial_held,
                              'unit_price_micro', v_existing.quiz_unit_price, 'replayed', true);
  END IF;

  -- Reclaim this caller's own abandoned holds, before the balance gate. Unchanged from 233
  -- except that the free side now hands back ITEMS as well as units.
  FOR v_stale IN
    SELECT id, quiz_free_held, quiz_trial_held, quiz_free_items_held, usage_date
      FROM ai_generation_jobs
     WHERE user_id = v_uid
       AND job_kind IN ('quiz_generate', 'quiz_grade')
       AND quiz_units_done IS NULL AND quiz_units_held > 0
       AND NOT charged AND NOT refunded
       AND created_at < now() - c_stale_after
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_stale.quiz_trial_held > 0 THEN
      UPDATE ai_quiz_trial SET units_remaining = units_remaining + v_stale.quiz_trial_held
       WHERE user_id = v_uid;
    END IF;
    IF v_stale.quiz_free_held > 0 OR v_stale.quiz_free_items_held > 0 THEN
      UPDATE ai_generation_usage
         SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - v_stale.quiz_free_held),
             free_quiz_items_used = GREATEST(0, free_quiz_items_used - v_stale.quiz_free_items_held)
       WHERE user_id = v_uid AND usage_date = v_stale.usage_date;
    END IF;
    UPDATE ai_generation_jobs
       SET quiz_units_done = 0, refunded = true
     WHERE id = v_stale.id;
  END LOOP;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count, COALESCE(free_quiz_units_used, 0), COALESCE(free_quiz_items_used, 0)
    INTO v_requests, v_free_used, v_free_items_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  SELECT COALESCE(units_remaining, 0) INTO v_trial_left
    FROM ai_quiz_trial WHERE user_id = v_uid FOR UPDATE;

  -- ── 정책을 묻는다 ─────────────────────────────────────────────────────────
  -- 여기가 233의 하드코딩을 대신합니다. 이 함수는 "채점"이라는 단어를 더 이상 모릅니다.
  SELECT * INTO v_allow FROM public._ai_free_allowance(v_uid, v_job_kind);
  IF NOT v_allow.trial_applies THEN v_trial_left := 0; END IF;

  IF v_allow.unit_kind = 'item' THEN
    -- 유형과 무관한 문항 단위. 서술형 한 문항과 객관식 한 문항이 무료 한도에서 똑같이 1입니다.
    SELECT * INTO v_items FROM public._ai_quiz_allocate_items(
      p_count, v_units_each, v_trial_left, GREATEST(0, v_allow.per_day - v_free_items_used));
    SELECT v_items.trial_items * v_units_each AS trial_units,
           v_items.free_items  * v_units_each AS free_units,
           v_items.paid_items  * v_units_each AS paid_units
      INTO v_alloc;
  ELSE
    -- 가중치 유닛 방식(예전 동작). 데이터로 되돌릴 수 있게 남겨둡니다.
    v_free_left := GREATEST(0, v_allow.per_day - v_free_used);
    SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_total, v_trial_left, v_free_left);
    SELECT (v_alloc.trial_units / GREATEST(v_units_each, 1)) AS trial_items,
           (v_alloc.free_units  / GREATEST(v_units_each, 1)) AS free_items,
           (v_alloc.paid_units  / GREATEST(v_units_each, 1)) AS paid_items
      INTO v_items;
  END IF;

  v_price := v_alloc.paid_units::bigint * s.quiz_unit_price_micro;

  IF v_price > p_max_price_micro THEN
    RAISE EXCEPTION 'Price changed since the quote' USING errcode = 'P0008';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  SELECT COALESCE(sum((quiz_units_held - quiz_free_held - quiz_trial_held)::bigint * quiz_unit_price), 0)
    INTO v_held
    FROM ai_generation_jobs
   WHERE user_id = v_uid AND quiz_units_done IS NULL AND quiz_units_held > 0
     AND NOT charged AND NOT refunded;
  IF COALESCE(v_balance, 0) < v_held + v_price THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  IF v_alloc.trial_units > 0 THEN
    UPDATE ai_quiz_trial SET units_remaining = units_remaining - v_alloc.trial_units
     WHERE user_id = v_uid;
  END IF;
  UPDATE ai_generation_usage
     SET req_count = req_count + 1,
         free_quiz_units_used = free_quiz_units_used + v_alloc.free_units,
         free_quiz_items_used = free_quiz_items_used + v_items.free_items,
         paid_quiz_units_used = paid_quiz_units_used + v_alloc.paid_units
   WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction,
     quiz_action, quiz_units_held, quiz_free_held, quiz_trial_held, quiz_unit_price,
     quiz_free_items_held, quiz_trial_items_held,
     quiz_set_id, quiz_run_item_id, client_ref)
  VALUES
    (v_ref, v_uid, v_today, 0, 0, 0, v_job_kind, 1.0,
     p_action, v_total, v_alloc.free_units, v_alloc.trial_units, s.quiz_unit_price_micro,
     v_items.free_items, v_items.trial_items,
     p_set_id, p_run_item_id, p_client_ref);

  RETURN jsonb_build_object('job_ref', v_ref, 'job_kind', v_job_kind, 'units', v_total,
                            'trial_units', v_alloc.trial_units, 'free_units', v_alloc.free_units,
                            'paid_units', v_alloc.paid_units,
                            'trial_items', v_items.trial_items, 'free_items', v_items.free_items,
                            'paid_items', v_items.paid_items,
                            'unit_price_micro', s.quiz_unit_price_micro,
                            'price_micro', v_price, 'replayed', false);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_quiz(text, integer, uuid, bigint, uuid, uuid[], uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_quiz(text, integer, uuid, bigint, uuid, uuid[], uuid, uuid) TO authenticated;

COMMIT;

-- ── 5. settle_ai_quiz — 미달 배달분을 문항으로 돌려준다 ─────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.settle_ai_quiz(p_user_id uuid, p_job_ref text, p_delivered integer, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_tokens_in integer DEFAULT NULL::integer, p_tokens_out integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j            ai_generation_jobs%ROWTYPE;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_delivered_units  integer;
  v_delivered_items  integer;
  v_trial_units integer := 0;
  v_free_units  integer := 0;
  v_paid_units  integer := 0;
  v_trial_items integer := 0;
  v_free_items  integer := 0;
  v_alloc      record;
  v_price      bigint := 0;
  v_bal        bigint;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint := 0; v_cost_won bigint := 0; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to settle' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN
    RETURN jsonb_build_object('settled', false);
  END IF;

  SELECT * INTO j FROM ai_generation_jobs
   WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.job_kind NOT LIKE 'quiz@_%' ESCAPE '@' THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'not_a_quiz_job');
  END IF;
  IF j.quiz_units_done IS NOT NULL OR j.charged OR j.refunded THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'already');
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  SELECT units INTO v_units_each FROM ai_quiz_price_units WHERE action = j.quiz_action;
  v_units_each := GREATEST(COALESCE(v_units_each, 1), 1);

  IF j.quiz_free_items_held = 0 AND j.quiz_trial_items_held = 0
     AND (j.quiz_free_held > 0 OR j.quiz_trial_held > 0) THEN
    -- 239 이전에 예약된 작업. 문항 홀드가 없으므로 예전 유닛 배분으로 정산합니다. 이걸 안 하면
    -- 배포 순간 비행 중이던 예약들이 무료분을 잃고 전액 과금됩니다.
    v_delivered_units := LEAST(j.quiz_units_held,
                               GREATEST(0, COALESCE(p_delivered, 0)) * v_units_each);
    SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_delivered_units, j.quiz_trial_held, j.quiz_free_held);
    v_trial_units := v_alloc.trial_units;
    v_free_units  := v_alloc.free_units;
    v_paid_units  := v_alloc.paid_units;
    v_delivered_items := v_delivered_units / v_units_each;
    v_trial_items := v_trial_units / v_units_each;
    v_free_items  := v_free_units  / v_units_each;
  ELSE
    -- 문항으로 정산. 체험 → 무료 → 유료 순서라 미달 배달은 유료분부터 돌려줍니다 —
    -- 학습자에게 유리한 방향입니다.
    v_delivered_items := LEAST(j.quiz_units_held / v_units_each,
                               GREATEST(0, COALESCE(p_delivered, 0)));
    v_trial_items := LEAST(v_delivered_items, j.quiz_trial_items_held);
    v_free_items  := LEAST(v_delivered_items - v_trial_items, j.quiz_free_items_held);
    v_delivered_units := v_delivered_items * v_units_each;
    v_trial_units := v_trial_items * v_units_each;
    v_free_units  := v_free_items  * v_units_each;
    v_paid_units  := GREATEST(0, v_delivered_units - v_trial_units - v_free_units);
  END IF;

  v_price := v_paid_units::bigint * j.quiz_unit_price;

  -- 배달되지 않은 무료·체험분을 돌려준다.
  IF j.quiz_trial_held - v_trial_units > 0 THEN
    UPDATE ai_quiz_trial
       SET units_remaining = units_remaining + (j.quiz_trial_held - v_trial_units)
     WHERE user_id = p_user_id;
  END IF;
  UPDATE ai_generation_usage
     SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - (j.quiz_free_held - v_free_units)),
         free_quiz_items_used = GREATEST(0, free_quiz_items_used - (j.quiz_free_items_held - v_free_items)),
         paid_quiz_units_used = GREATEST(0, paid_quiz_units_used
                                  - ((j.quiz_units_held - j.quiz_free_held - j.quiz_trial_held)
                                     - v_paid_units))
   WHERE user_id = p_user_id AND usage_date = j.usage_date;

  -- Cost is recorded even when the price is fixed, because margin observation is the
  -- only thing that will tell us if a model change makes a unit unprofitable.
  IF p_tokens_in IS NOT NULL AND p_tokens_out IS NOT NULL
     AND p_tokens_in >= 0 AND p_tokens_out >= 0 AND (p_tokens_in + p_tokens_out) > 0 THEN
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
    IF NOT FOUND OR v_in IS NULL THEN
      v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
    END IF;
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  END IF;
  v_margin := v_price - v_cost_won;
  v_bps := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;
  INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
      cost_usd_micros, cost_micro_usd, price_micro_usd, margin_micro_usd, margin_bps,
      rate_missing, estimated, under_target)
    VALUES (p_job_ref, p_user_id, p_provider, p_model,
      COALESCE(p_tokens_in, 0), COALESCE(p_tokens_out, 0),
      NULLIF(v_cost_usd, 0), NULLIF(v_cost_won, 0), v_price, v_margin, v_bps,
      v_missing, p_tokens_in IS NULL, false)
    ON CONFLICT (job_ref) DO NOTHING;

  IF v_price > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_price, updated_at = now()
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, -v_price, 'spend_quiz', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs
     SET quiz_units_done = v_delivered_units,
         price_micro_usd = v_price,
         charged  = (v_price > 0),
         refunded = (v_delivered_units = 0)
   WHERE id = p_job_ref;

  RETURN jsonb_build_object('settled', true, 'delivered_units', v_delivered_units,
                            'delivered_items', v_delivered_items,
                            'paid_units', v_paid_units, 'price_micro', v_price,
                            'balance', v_bal);
END;
$function$;

-- ── 6. get_ai_quiz_quote — 같은 정책을 읽고, 문항으로 답한다 ────────────────
CREATE OR REPLACE FUNCTION public.get_ai_quiz_quote(p_action text, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  s            ai_pricing_settings%ROWTYPE;
  v_units_each smallint;
  v_job_kind   text;
  v_total      integer;
  v_trial_left integer := 0;
  v_free_used  integer := 0;
  v_free_items_used integer := 0;
  v_free_left  integer;
  v_free_items_left integer;
  v_allow      record;
  v_items      record;
  v_alloc      record;
  v_balance    bigint := 0;
  v_held       bigint := 0;
  v_price      bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT units, job_kind INTO v_units_each, v_job_kind
    FROM ai_quiz_price_units WHERE action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown quiz action' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'count must be positive' USING errcode = 'invalid_parameter_value';
  END IF;
  v_total := v_units_each * p_count;

  SELECT COALESCE(units_remaining, 0) INTO v_trial_left FROM ai_quiz_trial WHERE user_id = v_uid;
  SELECT COALESCE(free_quiz_units_used, 0), COALESCE(free_quiz_items_used, 0)
    INTO v_free_used, v_free_items_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);
  v_free_items_used := COALESCE(v_free_items_used, 0);

  SELECT * INTO v_allow FROM public._ai_free_allowance(v_uid, v_job_kind);
  IF NOT v_allow.trial_applies THEN v_trial_left := 0; END IF;

  IF v_allow.unit_kind = 'item' THEN
    v_free_items_left := GREATEST(0, v_allow.per_day - v_free_items_used);
    v_free_left := v_free_items_left * v_units_each;   -- 화면 호환용 환산값
    SELECT * INTO v_items FROM public._ai_quiz_allocate_items(
      p_count, v_units_each, v_trial_left, v_free_items_left);
    SELECT v_items.trial_items * v_units_each AS trial_units,
           v_items.free_items  * v_units_each AS free_units,
           v_items.paid_items  * v_units_each AS paid_units
      INTO v_alloc;
  ELSE
    v_free_left := GREATEST(0, v_allow.per_day - v_free_used);
    v_free_items_left := v_free_left / GREATEST(v_units_each, 1);
    SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_total, v_trial_left, v_free_left);
    SELECT (v_alloc.trial_units / GREATEST(v_units_each, 1)) AS trial_items,
           (v_alloc.free_units  / GREATEST(v_units_each, 1)) AS free_items,
           (v_alloc.paid_units  / GREATEST(v_units_each, 1)) AS paid_items
      INTO v_items;
  END IF;

  v_price := v_alloc.paid_units::bigint * s.quiz_unit_price_micro;

  SELECT COALESCE(balance, 0) INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT COALESCE(sum((quiz_units_held - quiz_free_held - quiz_trial_held)::bigint * quiz_unit_price), 0)
    INTO v_held
    FROM ai_generation_jobs
   WHERE user_id = v_uid AND quiz_units_done IS NULL AND quiz_units_held > 0
     AND NOT charged AND NOT refunded;

  RETURN jsonb_build_object(
    'action', p_action,
    'count', p_count,
    'units_each', v_units_each,
    'units_total', v_total,
    'trial_units', v_alloc.trial_units,
    'free_units', v_alloc.free_units,
    'paid_units', v_alloc.paid_units,
    -- 문항 단위. 화면이 "무료 3문항 + 유료 2문항"이라고 말할 수 있는 유일한 숫자입니다.
    'trial_items', v_items.trial_items,
    'free_items', v_items.free_items,
    'paid_items', v_items.paid_items,
    'free_items_limit', v_allow.per_day,
    'free_items_remaining_today', v_free_items_left,
    'free_unit_kind', v_allow.unit_kind,
    'unit_price_micro', s.quiz_unit_price_micro,
    'price_micro', v_price,
    'balance_micro', COALESCE(v_balance, 0),
    'held_micro', v_held,
    'free_remaining_today', v_free_left,
    'trial_remaining', COALESCE(v_trial_left, 0),
    'max_units_per_call', s.quiz_max_units_per_call,
    'sufficient', COALESCE(v_balance, 0) >= v_held + v_price
  );
END;
$function$;

-- ── 7. 지갑 요약도 문항으로 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ai_wallet_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid    := auth.uid();
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_free_limit integer := public._ai_free_cards_per_day();
  v_free_used  integer;
  s            ai_pricing_settings%ROWTYPE;
  v_quiz_used  integer;
  v_quiz_allow record;
  v_trial      integer;
  result       json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT free_cards_used, COALESCE(free_quiz_items_used, 0)
    INTO v_free_used, v_quiz_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);
  v_quiz_used := COALESCE(v_quiz_used, 0);

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  SELECT COALESCE(units_remaining, 0) INTO v_trial FROM ai_quiz_trial WHERE user_id = v_uid;
  SELECT * INTO v_quiz_allow FROM public._ai_free_allowance(v_uid, 'quiz_generate');

  SELECT json_build_object(
    'balance_micro_usd',        COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    'est_price_per_card_micro', public._ai_est_price_per_card(),
    'free_limit',               v_free_limit,
    'free_used_today',          v_free_used,
    'free_remaining_today',     GREATEST(0, v_free_limit - v_free_used),
    -- 퀴즈는 이제 문항으로 셉니다. 유형 가중치가 사라졌으므로 화면도 "유닛"이라고 말하면
    -- 안 됩니다 — 문자열은 같은 커밋에서 바꿉니다.
    'quiz_unit_price_micro',      s.quiz_unit_price_micro,
    'quiz_free_limit',            v_quiz_allow.per_day,
    'quiz_free_used_today',       v_quiz_used,
    'quiz_free_remaining_today',  GREATEST(0, v_quiz_allow.per_day - v_quiz_used),
    'quiz_free_unit_kind',        v_quiz_allow.unit_kind,
    'quiz_trial_remaining',       COALESCE(v_trial, 0),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT delta, reason, balance_after, created_at
          FROM ai_credit_ledger
         WHERE user_id = v_uid
         ORDER BY created_at DESC
         LIMIT 30
      ) r
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$function$;

COMMIT;
