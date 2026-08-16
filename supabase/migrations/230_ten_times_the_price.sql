-- 230: every AI price, ten times over — and images priced at all.
--
-- The owner's call. The numbers say it is not unreasonable: a card was listed at 10,000 micro-USD
-- — one cent — against a measured cost of 161 micro on a short topic.
--
-- Three list prices move, and one gains a price it never had:
--
--   ai_action_prices.card                 10,000 -> 100,000    $0.01 -> $0.10 per paid card
--   ai_action_prices.remediation_explain  50,000 -> 500,000    $0.05 -> $0.50 per explanation
--   quiz_unit_price_micro                  5,000 ->  50,000    short grading is 2 units and
--                                                              essay 8, so $0.01 -> $0.10 and
--                                                              $0.04 -> $0.40
--   ai_action_prices.image                    -- -> 100,000    NEW, see below
--
-- `target_margin_bps` is deliberately LEFT AT 8,000. Raising it to 9,800 would have given the
-- cost-based path a 50x markup and thereby a ten-times charge — and it would also have redefined
-- `under_target` in `ai_cost_ledger`, which flags every job whose realised margin is below the
-- target. Every historical job would have gone red overnight and `get_ai_margin_daily` would have
-- reported a fleet-wide regression that never happened. A margin target and a price are not the
-- same knob and should not be made to be.
--
-- So images get a LIST price instead, which is what every other action has had since mig 216.
-- They were the last thing still charged from token cost x markup: the one price nobody could
-- quote in advance, the one that moved when a model's rates did, and the one a price change
-- expressed in `ai_action_prices` would silently have missed. 100,000 micro is ten times what
-- the cost-based path was charging for a representative image call (2,300 micro of cost at the
-- 5x markup came to 11,500).
--
-- Written as ABSOLUTE values guarded by the old ones, not `price_micro * 10`. A multiply is not
-- idempotent and a migration is not run exactly once — it is applied locally, applied to
-- production, and replayed from scratch by CI. Applying an earlier draft of this file twice by
-- hand turned a card into 1,000,000 micro: a hundred times, not ten. The WHERE clauses mean a
-- second run matches nothing.
--
-- What does NOT change: the free allowances. Ten free cards a day, ten quiz units a day and the
-- sixty-unit trial are what a learner meets before they ever meet a price, and raising the price
-- while shrinking the free tier would be two changes wearing one coat.
BEGIN;

UPDATE ai_action_prices SET price_micro = 100000, updated_at = now()
 WHERE action = 'card' AND price_micro = 10000;
UPDATE ai_action_prices SET price_micro = 500000, updated_at = now()
 WHERE action = 'remediation_explain' AND price_micro = 50000;

INSERT INTO ai_action_prices (action, price_micro, note)
VALUES ('image', 100000, 'One generated image. A list price so it can be quoted before the call, '
                         'like every other action since mig 216.')
ON CONFLICT (action) DO NOTHING;

UPDATE ai_pricing_settings
   SET quiz_unit_price_micro = 50000,
       -- The setup screen's ESTIMATE, so a quote does not undercount what the learner will
       -- actually be charged the moment they press the button.
       est_price_per_card_micro = 14810,
       updated_at = now()
 WHERE id = 1 AND quiz_unit_price_micro = 5000;

CREATE OR REPLACE FUNCTION public.reserve_ai_image()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid   := auth.uid();
  v_today date  := (now() AT TIME ZONE 'UTC')::date;
  v_reqs integer; v_bal bigint;
  v_ref  text   := gen_random_uuid()::text;
  v_price bigint;
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;
  -- A LIST price, agreed here, like every other action since mig 216.
  --
  -- Images were the last thing still charged from token cost x markup, which made them the one
  -- price nobody could quote in advance and the one that moved when a model's rates did. It also
  -- made them the only path that would have been missed by a price change expressed in the price
  -- table — the reason this is here rather than in a bumped `target_margin_bps`, which would have
  -- redefined `under_target` and turned every margin report red.
  v_price := COALESCE(public._ai_action_price('image'), 0);

  -- always paid → gate on a wallet that cannot cover it
  SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_uid;
  IF COALESCE(v_bal, 0) < GREATEST(v_price, 1) THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;
  UPDATE ai_generation_usage SET image_jobs = image_jobs + 1, req_count = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;
  INSERT INTO ai_generation_jobs (id, user_id, usage_date, free_cards, paid_cards, image_jobs,
                                  fixed_price_micro)
    VALUES (v_ref, v_uid, v_today, 0, 0, 1, NULLIF(v_price, 0));
  RETURN jsonb_build_object('job_ref', v_ref, 'price_micro', v_price);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserve_ai_image() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_image() TO authenticated;

COMMIT;
