-- ============================================================================
-- Quiz — SMOKE + NET-ZERO + DRY-RUN + ISOLATION audit.
--
-- A fast, high-signal companion to quiz_metering_test / quiz_run_rpcs_test, in the shape
-- `ai_metered_smoke_test.sql` established for the card meter:
--
--   SMOKE     — the whole flow works end to end (quote → reserve → questions → run →
--               answer → settle → wallet debited).
--   NET-ZERO  — every FAILURE path moves NO money. Release, zero-delivery settle, a
--               swept stale hold and a fully-free run must each leave the wallet, the
--               ledger and the counters exactly as they were.
--   DRY-RUN   — `get_ai_quiz_quote` and `count_quizzable_cards` preview and write NOTHING:
--               no job row, no ledger row, no counter movement, no trial consumed.
--   EXACTNESS — the price quoted is the price charged, to the micro-unit, when everything
--               asked for is delivered. That is the one promise the setup screen makes.
--   ISOLATION — one learner cannot read, answer, grade or overrule another's quiz, and
--               cannot see an answer key at all.
--
-- Single psql session; auth via request.jwt.claim.role/sub. Wallet is micro-USD bigint.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid    uuid := 'f1000000-0000-4000-8000-000000000001';
  v_other  uuid := 'f2000000-0000-4000-8000-000000000002';
  v_tpl    uuid; v_deck uuid; v_card uuid; v_set uuid; v_run uuid; v_item uuid;
  q        jsonb; r jsonb; res jsonb;
  b0 bigint; b1 bigint;
  led0 bigint; led1 bigint;
  jobs0 bigint; jobs1 bigint;
  trial0 integer; trial1 integer;
  free0 integer; free1 integer; paid0 integer; paid1 integer;
  v_n integer; v_txt text;
  i integer;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  SELECT id INTO v_tpl FROM card_templates WHERE user_id = v_uid AND name = '영어 단어';
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'FAIL: mig 097 seeding did not run'; END IF;

  INSERT INTO decks (user_id, name, default_template_id) VALUES (v_uid, 'SMOKE', v_tpl)
    RETURNING id INTO v_deck;
  FOR i IN 1..8 LOOP
    INSERT INTO cards (deck_id, user_id, template_id, field_values)
      VALUES (v_deck, v_uid, v_tpl,
              jsonb_build_object('field_1', 'w' || i, 'field_2', 'm' || i,
                                 'field_3', 'p' || i, 'field_4', 'e' || i));
  END LOOP;

  -- $1.00, no free units, no trial: every unit below is a PAID unit, so the arithmetic
  -- is visible rather than absorbed by an allowance.
  INSERT INTO ai_credit_balance (user_id, balance) VALUES (v_uid, 1000000)
    ON CONFLICT (user_id) DO UPDATE SET balance = 1000000;
  UPDATE ai_pricing_settings
     SET free_quiz_units_per_day = 0, quiz_trial_units = 0, quiz_unit_price_micro = 5000
   WHERE id = 1;
  -- 무료 한도는 239부터 `ai_free_allowances`에서 옵니다. 이 스위트는 유닛 산술을 검사하므로
  -- 정책도 유닛 방식으로 맞춰 둡니다(둘 다 지원됩니다). 예전 컬럼은 읽히지 않지만 함께
  -- 세팅해 두면 두 숫자가 어긋난 채 남지 않습니다.
  UPDATE ai_free_allowances SET per_day = 0, unit_kind = 'unit'
   WHERE tier = 'free' AND action_group = 'quiz_generate';

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- ══════════════════════════════════════════════════════════════════════════
  -- DRY-RUN — a quote is a read. Nothing about it may be observable afterwards.
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO led0 FROM ai_credit_ledger WHERE user_id = v_uid;
  SELECT count(*) INTO jobs0 FROM ai_generation_jobs WHERE user_id = v_uid;

  PERFORM public.get_ai_quiz_quote('generate_mcq', 6);
  PERFORM public.get_ai_quiz_quote('generate_essay', 3);
  PERFORM public.get_ai_quiz_quote('grade_short', 1);
  PERFORM public.count_quizzable_cards(v_deck);
  PERFORM public.count_quizzable_cards(v_deck, 'tags', ARRAY['nope']);

  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO led1 FROM ai_credit_ledger WHERE user_id = v_uid;
  SELECT count(*) INTO jobs1 FROM ai_generation_jobs WHERE user_id = v_uid;
  IF b0 <> b1 OR led0 <> led1 OR jobs0 <> jobs1 THEN
    RAISE EXCEPTION 'FAIL[DRY-RUN]: quoting moved something (bal %→%, ledger %→%, jobs %→%)',
      b0, b1, led0, led1, jobs0, jobs1;
  END IF;
  -- ...and it did not silently burn the daily counter either.
  SELECT COALESCE(req_count, 0) INTO v_n FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  IF COALESCE(v_n, 0) <> 0 THEN
    RAISE EXCEPTION 'FAIL[DRY-RUN]: quoting consumed % request(s) of the daily cap', v_n;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- SMOKE — quote → reserve → questions → run → answer → settle → debited.
  -- ══════════════════════════════════════════════════════════════════════════
  q := public.get_ai_quiz_quote('generate_mcq', 6);
  r := public.create_quiz_set(v_deck, 'Smoke set', 'mcq', 6, 'en');
  v_set := (r->>'set_id')::uuid;
  IF jsonb_array_length(r->'cards') <> 6 THEN
    RAISE EXCEPTION 'FAIL[SMOKE]: work list was % cards', jsonb_array_length(r->'cards');
  END IF;

  r := public.reserve_ai_quiz('generate_mcq', 6, gen_random_uuid(),
                              (q->>'price_micro')::bigint, v_deck);

  -- Reserve is a HOLD. If this ever debits, `_ai_pack_already_used` stops cancelling and a
  -- failed generation permanently consumes the learner's refund right on an unused pack.
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id = v_uid;
  IF b1 <> b0 THEN RAISE EXCEPTION 'FAIL[SMOKE]: reserve debited the wallet'; END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT id INTO v_card FROM cards WHERE deck_id = v_deck ORDER BY created_at LIMIT 1;
  PERFORM public.persist_quiz_questions(v_set, jsonb_build_array(
    jsonb_build_object('card_id', v_card, 'stem', 'What does w1 mean?',
      'options', jsonb_build_array('m1','m2','m3','m4'), 'correct_index', 0,
      'reference_answer', 'm1', 'source_fingerprint', 'fp')));
  -- Six units of work asked for, one question delivered.
  res := public.settle_ai_quiz(v_uid, r->>'job_ref', 1, 'google', 'gemini-2.5-flash-lite', 800, 200);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id = v_uid;
  IF b1 <> b0 - (res->>'price_micro')::bigint THEN
    RAISE EXCEPTION 'FAIL[SMOKE]: wallet % expected %', b1, b0 - (res->>'price_micro')::bigint;
  END IF;
  -- Charged for what SHIPPED: 1 question = 2 units, not the 12 held.
  IF (res->>'price_micro')::bigint <> 2 * 5000 THEN
    RAISE EXCEPTION 'FAIL[SMOKE]: charged % for one delivered question', res->>'price_micro';
  END IF;

  r := public.start_quiz_run(v_set);
  v_run := (r->>'run_id')::uuid;
  q := public.get_quiz_run_items(v_run);
  v_item := (q->'items'->0->>'item_id')::uuid;
  res := public.submit_quiz_answer(v_item, jsonb_build_object(
    'choice', (SELECT k - 1 FROM jsonb_array_elements_text(q->'items'->0->'options')
                 WITH ORDINALITY AS o(v, k) WHERE o.v = 'm1')));
  IF (res->>'score')::numeric <> 1 THEN
    RAISE EXCEPTION 'FAIL[SMOKE]: the correct choice scored %', res->>'score';
  END IF;
  PERFORM public.finish_quiz_run(v_run);

  -- Answering multiple choice is FREE, and stays free after 245.
  --
  -- 245 는 `grade_mcq` 를 가격표에 넣었지만 그것은 **해설**의 값입니다. 답을 제출하는 것 —
  -- 정답 판정을 받는 것 — 은 여전히 한 푼도 들지 않습니다. 이 단언이 바로 그 경계입니다:
  -- 여기서 잔액이 움직이면 채점이 유료가 된 것이고, 그건 제품 회귀입니다.
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id = v_uid;
  IF b0 <> b1 THEN RAISE EXCEPTION 'FAIL[SMOKE]: multiple-choice grading was charged'; END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- EXACTNESS — quoted == charged, to the micro-unit, on full delivery.
  -- ══════════════════════════════════════════════════════════════════════════
  q := public.get_ai_quiz_quote('generate_short', 4);
  r := public.reserve_ai_quiz('generate_short', 4, gen_random_uuid(),
                              (q->>'price_micro')::bigint, v_deck);
  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id = v_uid;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  res := public.settle_ai_quiz(v_uid, r->>'job_ref', 4, 'google', 'gemini-2.5-flash-lite', 900, 300);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  IF (res->>'price_micro')::bigint <> (q->>'price_micro')::bigint THEN
    RAISE EXCEPTION 'FAIL[EXACTNESS]: quoted % but charged %',
      q->>'price_micro', res->>'price_micro';
  END IF;
  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id = v_uid;
  IF b0 - b1 <> (q->>'price_micro')::bigint THEN
    RAISE EXCEPTION 'FAIL[EXACTNESS]: wallet moved % against a quote of %',
      b0 - b1, q->>'price_micro';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- NET-ZERO — four failure paths, none of which may move money.
  -- ══════════════════════════════════════════════════════════════════════════
  UPDATE ai_pricing_settings SET free_quiz_units_per_day = 6, quiz_trial_units = 10 WHERE id = 1;
  UPDATE ai_free_allowances SET per_day = 6, unit_kind = 'unit'
   WHERE tier = 'free' AND action_group = 'quiz_generate';
  PERFORM public.grant_ai_quiz_trial();

  SELECT balance INTO b0 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO led0 FROM ai_credit_ledger WHERE user_id = v_uid;
  SELECT units_remaining INTO trial0 FROM ai_quiz_trial WHERE user_id = v_uid;
  SELECT free_quiz_units_used, paid_quiz_units_used INTO free0, paid0
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;

  -- (a) a released job — the generation failed and reached its catch block
  r := public.reserve_ai_quiz('generate_mcq', 4, gen_random_uuid(), 999999, v_deck);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.release_ai_job(v_uid, r->>'job_ref');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- (b) a zero-delivery settle — the model returned nothing usable
  r := public.reserve_ai_quiz('generate_short', 3, gen_random_uuid(), 999999, v_deck);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.settle_ai_quiz(v_uid, r->>'job_ref', 0, NULL, NULL, NULL, NULL);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- (c) an abandoned hold — the request died before any of the above
  r := public.reserve_ai_quiz('generate_mcq', 2, gen_random_uuid(), 999999, v_deck);
  UPDATE ai_generation_jobs SET created_at = now() - INTERVAL '31 minutes'
   WHERE id = r->>'job_ref';
  -- The next reserve sweeps it. Reserve + release it too, so this leaves nothing behind.
  r := public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999, v_deck);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.release_ai_job(v_uid, r->>'job_ref');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT balance INTO b1 FROM ai_credit_balance WHERE user_id = v_uid;
  SELECT count(*) INTO led1 FROM ai_credit_ledger WHERE user_id = v_uid;
  SELECT units_remaining INTO trial1 FROM ai_quiz_trial WHERE user_id = v_uid;
  SELECT free_quiz_units_used, paid_quiz_units_used INTO free1, paid1
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;

  IF b0 <> b1 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: the wallet moved % → % across three failure paths', b0, b1;
  END IF;
  IF led0 <> led1 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: % ledger row(s) written for work never delivered', led1 - led0;
  END IF;
  IF trial0 <> trial1 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: trial units % → % — a failure consumed the allowance',
      trial0, trial1;
  END IF;
  IF free0 <> free1 OR paid0 <> paid1 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: unit counters moved free %→%, paid %→%',
      free0, free1, paid0, paid1;
  END IF;

  -- (d) a fully-free run charges zero and writes no ledger row at all.
  SELECT count(*) INTO led0 FROM ai_credit_ledger WHERE user_id = v_uid;
  r := public.reserve_ai_quiz('generate_mcq', 2, gen_random_uuid(), 0, v_deck);
  IF (r->>'paid_units')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: a run inside the allowance reserved % paid units',
      r->>'paid_units';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  res := public.settle_ai_quiz(v_uid, r->>'job_ref', 2, 'google', 'gemini-2.5-flash-lite', 500, 200);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  IF (res->>'price_micro')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL[NET-ZERO]: a free run was charged %', res->>'price_micro';
  END IF;
  SELECT count(*) INTO led1 FROM ai_credit_ledger WHERE user_id = v_uid;
  IF led0 <> led1 THEN RAISE EXCEPTION 'FAIL[NET-ZERO]: a free run wrote a ledger row'; END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- ISOLATION — the other learner reaches none of it, and no answer key leaks.
  -- ══════════════════════════════════════════════════════════════════════════
  q := public.get_quiz_run_items(v_run);
  v_txt := q::text;
  IF v_txt LIKE '%correct_index%' OR v_txt LIKE '%option_order%' THEN
    RAISE EXCEPTION 'FAIL[ISOLATION]: the answer key appeared in a run payload';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.get_quiz_run_items(v_run);
    RAISE EXCEPTION 'FAIL[ISOLATION]: read another learner run';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_quiz_answer(v_item, jsonb_build_object('choice', 0));
    RAISE EXCEPTION 'FAIL[ISOLATION]: answered another learner item';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.override_quiz_grade(v_item, 1);
    RAISE EXCEPTION 'FAIL[ISOLATION]: overrode another learner grade';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999, v_deck);
    RAISE EXCEPTION 'FAIL[ISOLATION]: reserved against another learner deck';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.reserve_ai_quiz('generate_mcq', 1, gen_random_uuid(), 999999, NULL, '{}', v_set);
    RAISE EXCEPTION 'FAIL[ISOLATION]: reserved against another learner quiz set';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The tables holding the key are unreadable at the privilege layer, before any policy.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM quiz_questions LIMIT 1;
    RAISE EXCEPTION 'FAIL[ISOLATION]: quiz_questions is SELECTable by authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM quiz_run_items LIMIT 1;
    RAISE EXCEPTION 'FAIL[ISOLATION]: quiz_run_items is SELECTable by authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'quiz_smoke_test: SMOKE + NET-ZERO + DRY-RUN + EXACTNESS + ISOLATION all passed';
END;
$$;

ROLLBACK;
