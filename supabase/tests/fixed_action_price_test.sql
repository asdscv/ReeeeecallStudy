-- Migration 216: what the learner pays is the list price, whatever the tokens came to.
--
-- Remediation and card generation used to bill cost x markup. That is why the same explanation
-- cost 1,095 one hour and 50,325 the next — a model changed underneath and the price followed
-- it. The quiz never had that problem because it sells units at a list price, and this gives
-- the other two paths the same shape.
--
-- Pinned here:
--   1) a cheap call and an expensive call on the same action charge the SAME price;
--   2) an unpriced model — the exact 43x condition from 214 — no longer changes what is
--      charged, only what the margin report says;
--   3) the wallet is gated on affording the LIST PRICE, not on being merely non-zero;
--   4) the free daily card allowance still costs nothing;
--   5) cost is still recorded, because margin reporting is the reason the ledger exists.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('d4000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits('d4000000-0000-4000-8000-000000000001'::uuid, 10000000, 'admin_grant', 'fixed_price_test');

DO $$
DECLARE
  v_uid uuid := 'd4000000-0000-4000-8000-000000000001';
  v_card_price bigint := public._ai_action_price('card');
  v_expl_price bigint := public._ai_action_price('remediation_explain');
  v_res jsonb; v_job text; v_charge jsonb;
  v_bal0 bigint; v_bal1 bigint;
  v_free integer := public._ai_free_cards_per_day();
BEGIN
  ASSERT v_card_price > 0, 'card has no list price';
  ASSERT v_expl_price > 0, 'remediation has no list price';

  -- ── (4) inside the free allowance, nothing is charged ────────────────────
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  v_res := reserve_ai_generation('cards', 1);
  ASSERT (v_res->>'paid_now')::int = 0, 'first card should be free';
  ASSERT (v_res->>'price_micro')::bigint = 0,
    format('a free card was priced: %s', v_res->>'price_micro');

  -- ── (1) a cheap call and an expensive call cost the learner the same ─────
  -- Spend the free allowance so the next cards are paid.
  UPDATE ai_generation_usage SET free_cards_used = v_free
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;

  v_res := reserve_ai_generation('cards', 2);
  v_job := v_res->>'job_ref';
  ASSERT (v_res->>'paid_now')::int = 2, 'both cards should now be paid';
  ASSERT (v_res->>'price_micro')::bigint = 2 * v_card_price,
    format('quoted %s for 2 cards, expected %s', v_res->>'price_micro', 2 * v_card_price);

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  -- A CHEAP call: 100 in, 100 out.
  v_charge := charge_ai_generation(v_uid, v_job, 'gemini', 'gemini-3.1-flash-lite', 100, 100);
  SELECT balance INTO v_bal1 FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT v_bal0 - v_bal1 = 2 * v_card_price,
    format('cheap call charged %s, list price is %s', v_bal0 - v_bal1, 2 * v_card_price);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  v_res := reserve_ai_generation('cards', 2);
  v_job := v_res->>'job_ref';
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  -- An EXPENSIVE call: 100x the tokens. Under the old markup this cost 100x more.
  v_charge := charge_ai_generation(v_uid, v_job, 'gemini', 'gemini-3.1-flash-lite', 10000, 10000);
  SELECT balance INTO v_bal1 FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT v_bal0 - v_bal1 = 2 * v_card_price,
    format('FAIL: a 100x-token call charged %s instead of the list price %s',
           v_bal0 - v_bal1, 2 * v_card_price);

  -- ── (2) an UNPRICED model no longer changes the charge ───────────────────
  -- This is 214's 43x condition exactly. It must now move the margin report and nothing else.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  v_res := reserve_ai_generation('cards', 2);
  v_job := v_res->>'job_ref';
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  SELECT balance INTO v_bal0 FROM ai_credit_balance WHERE user_id = v_uid;
  v_charge := charge_ai_generation(v_uid, v_job, 'gemini', 'a-model-nobody-priced', 5000, 5000);
  SELECT balance INTO v_bal1 FROM ai_credit_balance WHERE user_id = v_uid;
  ASSERT v_bal0 - v_bal1 = 2 * v_card_price,
    format('FAIL: an unpriced model charged %s instead of %s', v_bal0 - v_bal1, 2 * v_card_price);
  ASSERT EXISTS (SELECT 1 FROM ai_cost_ledger WHERE job_ref = v_job AND rate_missing),
    'the unpriced model should still be flagged in the ledger';

  -- ── (5) cost is still measured ───────────────────────────────────────────
  ASSERT (SELECT cost_usd_micros FROM ai_cost_ledger WHERE job_ref = v_job) > 0,
    'cost stopped being recorded — margin reporting is now blind';

  RAISE NOTICE 'fixed_action_price_test: all assertions passed';
END $$;

-- ── (3) the gate is the LIST PRICE, not "any balance at all" ───────────────
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$
DECLARE
  v_uid uuid := 'd4000000-0000-4000-8000-000000000001';
  v_card_price bigint := public._ai_action_price('card');
BEGIN
  -- One micro-USD short of a single card.
  UPDATE ai_credit_balance SET balance = v_card_price - 1 WHERE user_id = v_uid;
  UPDATE ai_generation_usage SET free_cards_used = public._ai_free_cards_per_day()
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  BEGIN
    PERFORM reserve_ai_generation('cards', 1);
    RAISE EXCEPTION 'FAIL: a wallet one micro short of the list price was allowed to commit';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  -- Exactly enough is enough.
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  UPDATE ai_credit_balance SET balance = v_card_price WHERE user_id = v_uid;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  PERFORM reserve_ai_generation('cards', 1);

  RAISE NOTICE 'fixed_action_price_test (gate): all assertions passed';
END $$;

ROLLBACK;
