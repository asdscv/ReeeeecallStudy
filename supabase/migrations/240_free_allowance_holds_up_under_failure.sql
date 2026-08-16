-- 240: 239의 무료 정책 커널을 실패 경로에서 다시 봤습니다.
--
-- 239는 프로덕션에 바로 적용됐고, 그 뒤 다섯 갈래로 적대적 리뷰를 돌렸습니다. 확인된 결함
-- 넷 중 셋이 데이터베이스 쪽이고, 셋 다 **정상 경로에서는 보이지 않습니다** — 생성이 성공하고,
-- 전부 배달되고, 아무도 동시에 누르지 않는 한.
--
-- 1) 생성이 실패하면 그날 무료 문항이 통째로 날아갔습니다  (치명적)
--
--    239는 `free_quiz_items_used`를 새로 만들면서 `release_ai_job`을 고치지 않았습니다.
--    엣지 함수는 생성 실패 때마다 이 함수를 부르고, 이 함수는 유닛만 돌려줍니다.
--
--      무료 5문항 예약 → 프로바이더 실패 → release → 유닛은 복구, 문항은 소모된 채
--      학습자가 재시도 → "무료 0문항, $0.50 차감" — 30초 전에 무료였던 그 다섯 문항
--
--    그날 남은 재시도가 전부 유료가 됩니다. 아무것도 못 받은 작업 때문에.
--
-- 2) `unit_kind = 'unit'`로 되돌리면 예약보다 비싸게 정산됐습니다  (높음)
--
--    239 헤더가 "가중치 방식으로 되돌리기: UPDATE 한 줄"이라고 광고하고 그 테스트가 실제로
--    그 UPDATE를 합니다. 그 모드에서 `quiz_free_items_held`는 유닛 배분의 **내림**이라,
--    정산이 그 내림값에서 무료 유닛을 다시 유도하면서 잘린 나머지를 유료로 청구했습니다.
--    실측: 서술형 5문항이 250,000으로 예약·잔액검사를 통과하고 300,000으로 정산 —
--    견적대로 딱 채워둔 지갑이 **-50,000**이 됩니다. `ai_credit_balance`에는 하한이 없습니다.
--
--    그리고 두 갈래를 고르는 조건 자체도 틀렸습니다. "239 이전 작업"을 문항 홀드가 0인 것으로
--    판별하는데, **전부 유료인 239 이후 작업**도 문항 홀드가 0입니다.
--
--    그래서 갈래를 없앴습니다. 예약이 실제로 가격을 매기고 잔액을 검사한 숫자
--    — `quiz_free_held` / `quiz_trial_held` — 위에서 배분하면 어느 모드에서도 승인액을 넘을 수
--    없습니다. item 모드에서는 예전 item 갈래와 **증명 가능하게 동일**합니다(거기서는
--    `quiz_free_held`가 정확히 `free_items * units_each`이므로).
--
-- 3) 잠금 순서가 반대라 교착이 있었습니다  (중간)
--
--    `settle_ai_quiz`, `release_ai_job`, 그리고 `reserve_ai_quiz` 자신의 stale 회수 루프까지
--    전부 체험 → 사용량 순으로 잠급니다. 예약 본문만 사용량 → 체험이었습니다. 미달 배달을
--    정산하는 트랜잭션과 채점을 예약하는 트랜잭션이 겹치면 둘 중 하나가 죽습니다.
--
-- 네 번째 결함(롤백이 `get_ai_wallet_summary`를 복원하지 않음)은 롤백 파일에서 고쳤습니다.
--
-- 아래 세 함수는 239의 본문에서 위 세 가지만 바꾼 것입니다.
BEGIN;

-- ── 1. 실패한 작업은 문항도 돌려준다 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_ai_job(p_user_id uuid, p_job_ref text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j public.ai_generation_jobs%ROWTYPE;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to release' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;
  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.refunded OR j.charged THEN RETURN; END IF;

  IF j.job_kind IN ('quiz_generate', 'quiz_grade') THEN
    -- Give back the units, not card counters, and never touch the wallet: reserve
    -- took no money, so there is nothing to return there.
    IF j.quiz_trial_held > 0 THEN
      UPDATE ai_quiz_trial SET units_remaining = units_remaining + j.quiz_trial_held
       WHERE user_id = p_user_id;
    END IF;
    UPDATE ai_generation_usage
       SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - j.quiz_free_held),
           -- AND THE ITEMS. 239 added this counter and left this function reading only units, so
           -- a failed generation returned the units and kept the questions — the learner's whole
           -- free allowance for the day, spent on work that produced nothing. Pre-239 jobs hold 0
           -- here, so subtracting it is a no-op for them.
           free_quiz_items_used = GREATEST(0, free_quiz_items_used - j.quiz_free_items_held),
           paid_quiz_units_used = GREATEST(0, paid_quiz_units_used
                                    - (j.quiz_units_held - j.quiz_free_held - j.quiz_trial_held))
     WHERE user_id = p_user_id AND usage_date = j.usage_date;
    UPDATE ai_generation_jobs SET refunded = true, quiz_units_done = 0 WHERE id = p_job_ref;
    RETURN;
  END IF;

  IF j.job_kind <> 'remediation' THEN
    UPDATE ai_generation_usage
       SET free_cards_used = GREATEST(0, free_cards_used - j.free_cards),
           paid_cards_used = GREATEST(0, paid_cards_used - j.paid_cards),
           image_jobs = GREATEST(0, image_jobs - j.image_jobs)
     WHERE user_id = p_user_id AND usage_date = j.usage_date;
  END IF;
  UPDATE ai_generation_jobs SET refunded = true WHERE id = p_job_ref;
END;
$function$;

-- ── 2. 정산은 예약이 매긴 유닛 위에서, 갈래 없이 ────────────────────────────
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

  -- ONE PATH, and it prices from the UNITS the job holds.
  --
  -- 239 had two: an item branch and a "job reserved before 239" branch, chosen by whether the
  -- item holds were zero. Both were wrong in one direction each.
  --
  --   * The branch test misfires on a post-239 job whose whole batch was paid — no free items,
  --     no trial items — which is indistinguishable from a pre-239 job by that test.
  --   * The item branch re-derived the free UNITS from the item counts. In `unit_kind = 'unit'`
  --     mode — the data-only revert this migration advertises — `quiz_free_items_held` is a
  --     FLOOR of the unit allowance, so the remainder was re-priced as paid: measured, an essay
  --     batch reserved and balance-gated at 250,000 settled at 300,000, and a wallet holding
  --     exactly the quoted amount went to -50,000.
  --
  -- Allocating over `quiz_free_held` / `quiz_trial_held` — the exact numbers reserve priced and
  -- gated the balance against — cannot exceed what was approved, in either mode. In item mode it
  -- is provably identical to what the item branch computed (`quiz_free_held` is exactly
  -- `free_items * units_each` there), so nothing changes for the jobs running today. The item
  -- counters keep their own arithmetic, because they are what `free_quiz_items_used` refunds.
  v_delivered_items := LEAST(j.quiz_units_held / v_units_each,
                             GREATEST(0, COALESCE(p_delivered, 0)));
  v_delivered_units := v_delivered_items * v_units_each;

  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_delivered_units, j.quiz_trial_held, j.quiz_free_held);
  v_trial_units := v_alloc.trial_units;
  v_free_units  := v_alloc.free_units;
  v_paid_units  := v_alloc.paid_units;

  v_trial_items := LEAST(v_delivered_items, j.quiz_trial_items_held);
  v_free_items  := LEAST(v_delivered_items - v_trial_items, j.quiz_free_items_held);

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

-- ── 3. 예약도 체험 → 사용량 순서로 잠근다 ──────────────────────────────────
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

  -- TRIAL FIRST, THEN USAGE — one lock order for every path that touches both.
  --
  -- settle_ai_quiz, release_ai_job and this function's own stale-reclaim loop all take the trial
  -- row before the usage row. This one used to take them the other way round, so a settle
  -- refunding trial units while a grade reserve held the usage row was a deadlock: Postgres kills
  -- one of them and the learner sees a failure with no cause. Reading the trial here is also
  -- correct on its own terms — it must come after the stale loop, which refunds into it.
  SELECT COALESCE(units_remaining, 0) INTO v_trial_left
    FROM ai_quiz_trial WHERE user_id = v_uid FOR UPDATE;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count, COALESCE(free_quiz_units_used, 0), COALESCE(free_quiz_items_used, 0)
    INTO v_requests, v_free_used, v_free_items_used
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;


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
