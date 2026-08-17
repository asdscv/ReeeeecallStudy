-- Quiz metering (migration 194) — the money path.
--
-- Three properties carry the design, and each is checked here against the ledger rather than
-- against a return value:
--
--   1. RESERVE MOVES NO MONEY. A debit at reserve followed by a compensating credit does not
--      cancel in `_ai_pack_already_used`, which sums `delta < 0 AND reason <> 'refund'` — so a
--      failed generation would permanently consume the learner's right to refund an unused pack.
--   2. SETTLE CHARGES ONLY WHAT SHIPPED, at a price that exists in the price list. The
--      allocation is re-run over delivered units instead of pro-rated, because pro-rating
--      invents amounts that correspond to no row and breaks the quoted-price promise.
--   3. AN ACTION WITH NO ROW CANNOT BE CHARGED. grade_mcq is absent from ai_quiz_price_units,
--      so free multiple-choice grading is structural, not a rule someone has to remember.
--
-- Plus the two existing money functions, which had to be taught about quiz: charge_ai_generation
-- would have priced a quiz job at zero AND stamped it charged, freezing the hold forever; and
-- release_ai_job would have decremented card counters a quiz job never incremented.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid    uuid := 'd1000000-0000-4000-8000-000000000001';
  v_other  uuid := 'd2000000-0000-4000-8000-000000000002';
  v_tmpl   uuid; v_deck uuid; v_card uuid;
  v_odeck  uuid; v_ocard uuid;
  v_set    uuid;
  q        jsonb;
  r1       jsonb;
  r2       jsonb;
  v_bal0   bigint;
  v_bal    bigint;
  v_rows   integer;
  v_free   integer;
  v_paid   integer;
  v_trial  integer;
  v_price  bigint;
  v_refunded boolean;
  v_done   integer;
  v_key    text;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout)
    VALUES (v_uid, 'QT',
            '[{"key":"f","name":"F","type":"text","order":0},{"key":"b","name":"B","type":"text","order":1}]'::jsonb,
            '[{"field_key":"f","style":"primary"}]'::jsonb,
            '[{"field_key":"b","style":"primary"}]'::jsonb)
    RETURNING id INTO v_tmpl;
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'D', v_tmpl)
    RETURNING id INTO v_deck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_deck, v_uid, v_tmpl, '{"f":"q","b":"a"}'::jsonb) RETURNING id INTO v_card;

  -- Another learner's deck and card, for the access checks.
  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_other, 'OTHER', v_tmpl)
    RETURNING id INTO v_odeck;
  INSERT INTO cards (deck_id, user_id, template_id, field_values)
    VALUES (v_odeck, v_other, v_tmpl, '{"f":"q","b":"a"}'::jsonb) RETURNING id INTO v_ocard;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         requested_count, content_locale)
    VALUES (v_uid, v_deck, 'S', 'mcq', 'deck', 4, 'en') RETURNING id INTO v_set;

  -- $100.00 of balance, no trial, no free units — so every unit below is a paid unit and
  -- the arithmetic is visible.
  -- Ten times the prices means ten times the float this fixture needs; it was 1,000,000 when a
  -- unit cost 5,000, and 8 units at 50,000 is 400,000 with reservations stacking on top.
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 100000000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 100000000;
  UPDATE ai_pricing_settings SET free_quiz_units_per_day = 0, quiz_trial_units = 0 WHERE id = 1;
  -- 무료 한도는 239부터 `ai_free_allowances`에서 옵니다. 이 스위트는 유닛 산술을 검사하므로
  -- 정책도 유닛 방식으로 맞춰 둡니다(둘 다 지원됩니다). 예전 컬럼은 읽히지 않지만 함께
  -- 세팅해 두면 두 숫자가 어긋난 채 남지 않습니다.
  UPDATE ai_free_allowances SET per_day = 0, unit_kind = 'unit'
   WHERE tier = 'free' AND action_group = 'quiz_generate';

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ── 1) grade_mcq cannot be priced, therefore cannot be charged ────────────
  --
  -- 이 자리는 하루 사이에 두 번 뒤집혔습니다. 245 가 해설을 답한 뒤 파는 것으로 만들면서 값을
  -- 넣었고, 252 가 해설을 **생성 시점으로** 옮기면서 값을 없앴습니다 — 오답 보기마다 축을
  -- 하나씩 쓰면 학습자가 무엇을 고르든 해설이 이미 있으므로 두 번째 호출이 필요 없습니다.
  --
  -- 그래서 객관식은 채점도 해설도 무료이고, 가격표에 행이 없다는 것이 곧 그 시행입니다.
  BEGIN
    PERFORM public.get_ai_quiz_quote('grade_mcq', 1);
    RAISE EXCEPTION 'FAIL: grade_mcq was quotable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.reserve_ai_quiz('grade_mcq', 1, gen_random_uuid(), 999999);
    RAISE EXCEPTION 'FAIL: grade_mcq was reservable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── 2) The quote is the arithmetic the charge will use ────────────────────
  q := public.get_ai_quiz_quote('generate_mcq', 4);
  IF (q->>'units_each')::int <> 2 OR (q->>'units_total')::int <> 8 THEN
    RAISE EXCEPTION 'FAIL: quote units wrong: %', q;
  END IF;
  -- Read from settings rather than hardcoded: mig 230 multiplied every price by ten, and a
  -- test that pins the literal breaks on a price change instead of on a pricing BUG.
  IF (q->>'paid_units')::int <> 8
     OR (q->>'price_micro')::bigint <> 8 * (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: quote price wrong: %', q;
  END IF;
  IF (q->>'sufficient')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: quote said insufficient at balance 100000000: %', q;
  END IF;

  -- ── 3) Reserve moves NO money ─────────────────────────────────────────────
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO v_rows FROM ai_credit_ledger WHERE user_id = v_uid;

  r1 := public.reserve_ai_quiz('generate_mcq', 4, 'e1000000-0000-4000-8000-000000000001',
                               999999, v_deck);
  IF (r1->>'units')::int <> 8 OR (r1->>'paid_units')::int <> 8 THEN
    RAISE EXCEPTION 'FAIL: reserve units wrong: %', r1;
  END IF;

  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF v_bal <> v_bal0 THEN
    RAISE EXCEPTION 'FAIL: reserve moved the balance % -> %', v_bal0, v_bal;
  END IF;
  IF (SELECT count(*) FROM ai_credit_ledger WHERE user_id = v_uid) <> v_rows THEN
    RAISE EXCEPTION 'FAIL: reserve wrote a ledger row — this is what burns a refundable pack';
  END IF;

  -- ── 4) The same gesture replayed reserves nothing new ─────────────────────
  r2 := public.reserve_ai_quiz('generate_mcq', 4, 'e1000000-0000-4000-8000-000000000001',
                               999999, v_deck);
  IF (r2->>'job_ref') IS DISTINCT FROM (r1->>'job_ref')
     OR (r2->>'replayed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: replay created a second job: % vs %', r1, r2;
  END IF;
  SELECT count(*) INTO v_rows FROM ai_generation_jobs WHERE user_id = v_uid AND job_kind = 'quiz_generate';
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL: % quiz jobs after replay', v_rows; END IF;

  -- ...but the same key with different parameters is a bug in the caller, not a replay.
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 6, 'e1000000-0000-4000-8000-000000000001',
                                   999999, v_deck);
    RAISE EXCEPTION 'FAIL: client_ref reuse with different count was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── 5) The hold counts against the next reserve ───────────────────────────
  -- 8 units are held ($0.04). A request for the remaining balance must see them.
  q := public.get_ai_quiz_quote('generate_mcq', 4);
  IF (q->>'held_micro')::bigint <> 8 * (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: outstanding hold not reflected in quote: %', q;
  END IF;

  -- ── 6) Access is checked, and checked BEFORE the idempotent early return ──
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999, v_odeck);
    RAISE EXCEPTION 'FAIL: reserved against another learner deck';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999,
                                   NULL, ARRAY[v_ocard]);
    RAISE EXCEPTION 'FAIL: reserved against another learner card';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A replayed client_ref must not become a way to smuggle a foreign card id past the check.
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 4, 'e1000000-0000-4000-8000-000000000001',
                                   999999, NULL, ARRAY[v_ocard]);
    RAISE EXCEPTION 'FAIL: replay with a foreign card id was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── 7) An approved price is honoured ──────────────────────────────────────
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 4, gen_random_uuid(), 1);
    RAISE EXCEPTION 'FAIL: charged more than the learner approved';
  EXCEPTION WHEN sqlstate 'P0008' THEN NULL;
  END;

  -- ── 8) Too-large is NOT the daily cap, and must not be reported as one ────
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 100, gen_random_uuid(), 99999999);
    RAISE EXCEPTION 'FAIL: oversized request accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'FAIL: size error raised 23514, which every caller renders as "daily limit"';
    WHEN sqlstate 'P0009' THEN NULL;
  END;

  -- ── 9) Settle charges for delivered units only ───────────────────────────
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  -- 4 questions asked for, 3 delivered → 6 of the 8 held units are billable.
  q := public.settle_ai_quiz(v_uid, r1->>'job_ref', 3, 'google', 'gemini-2.5-flash-lite', 900, 300);
  IF (q->>'delivered_units')::int <> 6 OR (q->>'paid_units')::int <> 6 THEN
    RAISE EXCEPTION 'FAIL: settle units wrong: %', q;
  END IF;
  v_price := (q->>'price_micro')::bigint;
  IF v_price <> 6 * (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: settle price % is not 6 units at list', v_price;
  END IF;

  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF v_bal <> v_bal0 - v_price THEN
    RAISE EXCEPTION 'FAIL: balance % expected %', v_bal, v_bal0 - v_price;
  END IF;
  SELECT count(*) INTO v_rows FROM ai_credit_ledger
   WHERE user_id = v_uid AND reason = 'spend_quiz' AND delta = -v_price;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL: % spend_quiz ledger rows', v_rows; END IF;

  -- Settling twice must not double-charge.
  q := public.settle_ai_quiz(v_uid, r1->>'job_ref', 3, NULL, NULL, NULL, NULL);
  IF (q->>'settled')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: settled the same job twice: %', q;
  END IF;

  -- ── 10) Nothing delivered, nothing charged, no ledger row ────────────────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  r2 := public.reserve_ai_quiz('generate_essay', 2, gen_random_uuid(), 999999, v_deck);
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO v_rows FROM ai_credit_ledger WHERE user_id = v_uid;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  q := public.settle_ai_quiz(v_uid, r2->>'job_ref', 0, NULL, NULL, NULL, NULL);
  IF (q->>'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: charged for an undelivered job: %', q;
  END IF;
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF v_bal <> v_bal0 THEN RAISE EXCEPTION 'FAIL: zero delivery moved the balance'; END IF;
  IF (SELECT count(*) FROM ai_credit_ledger WHERE user_id = v_uid) <> v_rows THEN
    RAISE EXCEPTION 'FAIL: zero delivery wrote a ledger row';
  END IF;

  -- ── 11) Free and trial units come off first, and come back on shortfall ──
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  UPDATE ai_pricing_settings SET free_quiz_units_per_day = 4, quiz_trial_units = 2 WHERE id = 1;
  UPDATE ai_free_allowances SET per_day = 4, unit_kind = 'unit'
   WHERE tier = 'free' AND action_group = 'quiz_generate';
  PERFORM public.grant_ai_quiz_trial();

  -- 4 mcq = 8 units: 2 trial, 4 free, 2 paid.
  q := public.get_ai_quiz_quote('generate_mcq', 4);
  IF (q->>'trial_units')::int <> 2 OR (q->>'free_units')::int <> 4
     OR (q->>'paid_units')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL: allocation wrong: %', q;
  END IF;

  r2 := public.reserve_ai_quiz('generate_mcq', 4, gen_random_uuid(), 999999, v_deck);
  SELECT units_remaining INTO v_trial FROM ai_quiz_trial WHERE user_id = v_uid;
  IF v_trial <> 0 THEN RAISE EXCEPTION 'FAIL: trial not consumed, % left', v_trial; END IF;

  -- Deliver 1 of 4 → 2 units used, which the trial alone covers. The free and paid
  -- units go back, and nothing is charged.
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  q := public.settle_ai_quiz(v_uid, r2->>'job_ref', 1, NULL, NULL, NULL, NULL);
  IF (q->>'paid_units')::int <> 0 OR (q->>'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: paid units charged while trial units covered delivery: %', q;
  END IF;
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF v_bal <> v_bal0 THEN RAISE EXCEPTION 'FAIL: balance moved on a fully-free delivery'; END IF;

  SELECT free_quiz_units_used, paid_quiz_units_used INTO v_free, v_paid
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  IF v_paid <> 6 THEN   -- 6 from the first settled job; the second job's 2 were returned
    RAISE EXCEPTION 'FAIL: paid units used is %, expected 6', v_paid;
  END IF;

  -- ── 12) The card meter refuses quiz jobs outright ────────────────────────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  r2 := public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999, v_deck);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  q := public.charge_ai_generation(v_uid, r2->>'job_ref', 'google', 'gemini-2.5-flash-lite', 100, 100);
  IF (q->>'charged')::boolean IS NOT FALSE OR (q->>'reason') IS DISTINCT FROM 'quiz_uses_settle' THEN
    RAISE EXCEPTION 'FAIL: charge_ai_generation did not refuse a quiz job: %', q;
  END IF;
  -- ...and having refused, it must not have stamped the job charged, or the hold is stuck.
  IF (SELECT charged FROM ai_generation_jobs WHERE id = r2->>'job_ref') THEN
    RAISE EXCEPTION 'FAIL: quiz job was stamped charged, freezing its hold forever';
  END IF;

  -- ── 13) Releasing a quiz job leaves the CARD counters alone ──────────────
  UPDATE ai_generation_usage SET free_cards_used = 7, paid_cards_used = 5
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  PERFORM public.release_ai_job(v_uid, r2->>'job_ref');
  SELECT free_cards_used, paid_cards_used INTO v_free, v_paid
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  IF v_free <> 7 OR v_paid <> 5 THEN
    RAISE EXCEPTION 'FAIL: release of a quiz job moved card counters to %/% — a silent free-quota leak',
      v_free, v_paid;
  END IF;

  -- ── 14) An abandoned hold does not shorten the wallet forever ────────────
  -- pg_cron is not installed, so `sweep_ai_quiz_holds` would never run on its own.
  -- Reserve settles the CALLER's own stale holds first — the only wallet a stale hold
  -- can block is theirs. Without this the learner is permanently short by the
  -- abandoned amount, with nothing on any screen to explain it.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  UPDATE ai_pricing_settings SET free_quiz_units_per_day = 0, quiz_trial_units = 0 WHERE id = 1;
  UPDATE ai_free_allowances SET per_day = 0, unit_kind = 'unit'
   WHERE tier = 'free' AND action_group = 'quiz_generate';
  UPDATE ai_quiz_trial SET units_remaining = 0 WHERE user_id = v_uid;
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 100000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 1000000;

  -- 8 mcq = 16 units = $0.80 of a $1.00 balance. Held, never delivered. Ten times what it was:
  -- mig 230 multiplied the unit price, and this scenario only means anything while the hold is
  -- MOST of the balance.
  r1 := public.reserve_ai_quiz('generate_mcq', 8, gen_random_uuid(), 9999999, v_deck);
  q := public.get_ai_quiz_quote('generate_mcq', 4);
  IF (q->>'sufficient')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: the hold should have made a second request unaffordable: %', q;
  END IF;

  -- Still fresh: not swept, and the balance is still blocked.
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 4, gen_random_uuid(), 999999, v_deck);
    RAISE EXCEPTION 'FAIL: reserved past a live hold';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;

  -- Now abandon it.
  UPDATE ai_generation_jobs SET created_at = now() - INTERVAL '31 minutes'
   WHERE id = r1->>'job_ref';

  r2 := public.reserve_ai_quiz('generate_mcq', 4, gen_random_uuid(), 999999, v_deck);
  IF (r2->>'job_ref') IS NULL THEN
    RAISE EXCEPTION 'FAIL: a stale hold still blocked the wallet';
  END IF;
  SELECT refunded, quiz_units_done INTO v_refunded, v_done
    FROM ai_generation_jobs WHERE id = r1->>'job_ref';
  IF v_refunded IS NOT TRUE OR v_done <> 0 THEN
    RAISE EXCEPTION 'FAIL: stale hold was not settled at zero (refunded=%, done=%)', v_refunded, v_done;
  END IF;
  -- Settling at zero writes no ledger row: nothing was delivered, so nothing is owed.
  SELECT count(*) INTO v_rows FROM ai_credit_ledger
   WHERE user_id = v_uid AND ref = r1->>'job_ref';
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: sweeping a hold charged for it'; END IF;

  -- ── 15) The wallet summary reports the quiz allowance ────────────────────
  -- Without these keys the 60-unit trial exists only inside a quote on the setup
  -- screen, where a learner who has not opened quiz can never find it.
  q := public.get_ai_wallet_summary()::jsonb;
  FOREACH v_key IN ARRAY ARRAY['quiz_unit_price_micro', 'quiz_free_limit',
                               'quiz_free_used_today', 'quiz_free_remaining_today',
                               'quiz_trial_remaining'] LOOP
    IF NOT (q ? v_key) THEN
      RAISE EXCEPTION 'FAIL: wallet summary is missing %', v_key;
    END IF;
  END LOOP;
  IF (q->>'quiz_unit_price_micro')::bigint
       <> (SELECT quiz_unit_price_micro FROM ai_pricing_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'FAIL: wallet reported unit price %', q->>'quiz_unit_price_micro';
  END IF;

  RAISE NOTICE 'quiz_metering_test: all assertions passed';
END;
$$;

ROLLBACK;
