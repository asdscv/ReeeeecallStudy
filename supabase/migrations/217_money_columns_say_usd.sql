-- 217: the money columns say "won" and hold micro-USD.
--
-- The app was priced in KRW once. Migration 145 moved it to USD and left the column names
-- behind, so `price_won_micros`, `amount_micro_won` and four others have been holding
-- micro-dollars under a Korean-currency name ever since. `ai_pricing_settings.usd_won_rate`
-- still sits in the charge arithmetic as a multiplier, pinned to 1 by a CHECK constraint added
-- in mig 149 precisely so nobody can "fix" it to a real exchange rate and multiply every charge
-- by thirteen hundred.
--
-- Nothing here changes a value or an arithmetic. Every rename is a name.
--
--     ai_cost_ledger.cost_won_micros     -> cost_micro_usd
--     ai_cost_ledger.margin_won_micros   -> margin_micro_usd
--     ai_cost_ledger.price_won_micros    -> price_micro_usd
--     ai_generation_jobs.price_micro_won -> price_micro_usd     (also fixes the word order)
--     billing_products.credits_micro_won -> credits_micro_usd
--     payment_intents.amount_micro_won   -> amount_micro_usd
--
-- The function bodies below were read back from `pg_get_functiondef` and rewritten by
-- substitution rather than retyped, so nothing else in them can have drifted. Four of them
-- (`create_payment_intent`, `confirm_payment`, `clawback_credits`, `clawback_credits_partial`)
-- are on the live payment path, which is why this is mechanical and why the test asserts
-- afterwards that no function anywhere still mentions an old name.
--
-- LEFT ALONE, deliberately:
--   * `usd_won_rate` — the name already says usd, the CHECK documents that it is 1, and
--     removing it from the arithmetic is a behaviour change rather than a rename.
--   * `won_per_credit` — an admin-settable knob; renaming it changes
--     `set_ai_pricing_settings`'s signature and the admin client that calls it, for a column
--     no charge path reads any more.
--   Both get a COMMENT instead.
BEGIN;

-- Guarded so the migration is re-runnable: a rename is not `IF EXISTS`-able on its own, and a
-- migration that only works once is a migration that cannot be verified against a fresh reset.
DO $rename$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ai_cost_ledger',     'cost_won_micros',   'cost_micro_usd'),
      ('ai_cost_ledger',     'margin_won_micros', 'margin_micro_usd'),
      ('ai_cost_ledger',     'price_won_micros',  'price_micro_usd'),
      ('ai_generation_jobs', 'price_micro_won',   'price_micro_usd'),
      ('billing_products',   'credits_micro_won', 'credits_micro_usd'),
      ('payment_intents',    'amount_micro_won',  'amount_micro_usd')
    ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=r.tbl AND column_name=r.old_name) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END
$rename$;

COMMENT ON COLUMN public.ai_pricing_settings.usd_won_rate IS
  'Legacy display multiplier from when this app was priced in KRW. Pinned to 1 by a CHECK '
  '(mig 149) — setting it to a real exchange rate would multiply every AI charge by it.';
COMMENT ON COLUMN public.ai_pricing_settings.won_per_credit IS
  'Legacy. No charge path reads this any more; kept because set_ai_pricing_settings exposes it.';

CREATE OR REPLACE FUNCTION public.admin_billing_overview()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    'active_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'active' AND environment IS DISTINCT FROM 'sandbox'),
    'canceling',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE cancel_at_period_end = true AND environment IS DISTINCT FROM 'sandbox'),
    'past_due',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'past_due' AND environment IS DISTINCT FROM 'sandbox'),
    'mrr_micro_won',
      COALESCE((
        SELECT SUM(p.price_usd_cents::bigint * 10000)
        FROM billing_subscriptions s
        JOIN billing_products p ON p.id = s.product_id
        WHERE s.status = 'active' AND s.environment IS DISTINCT FROM 'sandbox'
      ), 0),
    -- The full spendable liability, test credits included — those really can be
    -- spent, so netting them out here would understate what we owe.
    'wallet_total_micro',
      COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    'paid_revenue_30d_micro',
      COALESCE((
        SELECT SUM(COALESCE(pi.amount_micro_usd, bp.price_usd_cents::bigint * 10000, 0))
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.status = 'paid' AND pi.paid_at > now() - interval '30 days'
      ), 0),
    'refunds_30d',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'refunded' AND updated_at > now() - interval '30 days'
          AND environment IS DISTINCT FROM 'sandbox'),
    -- ── sandbox, reported not hidden ──
    'sandbox_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE environment = 'sandbox'),
    'sandbox_granted_micro',
      COALESCE((SELECT SUM(delta) FROM ai_credit_ledger
                 WHERE environment = 'sandbox' AND delta > 0), 0),
    'sandbox_grants_enabled', public.sandbox_grants_enabled()
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_billing(p_user uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    'subscription', (
      SELECT row_to_json(s) FROM (
        SELECT id, user_id, product_id, tier, status, card_limit, provider,
               provider_ref, provider_subscription_id, current_period_end,
               cancel_at_period_end, created_at, updated_at
        FROM billing_subscriptions
        WHERE user_id = p_user
        ORDER BY (status = 'active') DESC, updated_at DESC
        LIMIT 1
      ) s),
    'wallet_micro',
      COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user), 0),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(l)) FROM (
        SELECT delta, reason, balance_after, created_at
        FROM ai_credit_ledger
        WHERE user_id = p_user
        ORDER BY created_at DESC
        LIMIT 20
      ) l), '[]'::json),
    'payments', COALESCE((
      SELECT json_agg(row_to_json(pm)) FROM (
        SELECT pi.merchant_uid, pi.product_id, pi.kind, pi.amount_krw,
               COALESCE(pi.amount_micro_usd, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
               pi.status, pi.paid_at, pi.created_at
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.user_id = p_user
        ORDER BY pi.created_at DESC
        LIMIT 20
      ) pm), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_payments(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_platform text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT * FROM (
      SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
             pi.amount_krw,
             COALESCE(pi.amount_micro_usd, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
             pi.status, pi.provider, pi.provider_payment_id,
             pi.paid_at, pi.created_at,
             pi.platform,
             'production'::text AS environment,
             public._billing_channel(pi.platform, pi.provider) AS channel,
             public._channel_has_money_api(
               public._billing_channel(pi.platform, pi.provider)) AS can_refund_money
      FROM payment_intents pi
      LEFT JOIN auth.users u ON u.id = pi.user_id
      LEFT JOIN billing_products bp ON bp.id = pi.product_id
      WHERE p_platform IS NULL OR pi.platform = p_platform

      UNION ALL

      SELECT l.ref AS merchant_uid, l.user_id, u.email, NULL::text AS product_id,
             'credit_pack'::text AS kind,
             NULL::integer AS amount_krw,
             l.delta::bigint AS amount_micro,
             -- WAS: 'paid'::text. A standing refund makes this row 'refunded';
             -- a reversed refund (REFUND_REVERSED) makes it 'paid' again.
             CASE WHEN public.credit_grant_is_refunded(l.ref)
                  THEN 'refunded'::text ELSE 'paid'::text END AS status,
             'revenuecat'::text AS provider,
             l.ref AS provider_payment_id,
             l.created_at AS paid_at, l.created_at,
             l.platform,
             COALESCE(l.environment, 'production') AS environment,
             public._billing_channel(l.platform, 'revenuecat') AS channel,
             public._channel_has_money_api(
               public._billing_channel(l.platform, 'revenuecat')) AS can_refund_money
      FROM ai_credit_ledger l
      LEFT JOIN auth.users u ON u.id = l.user_id
      WHERE l.delta > 0
        AND l.reason = 'purchase'
        AND l.ref IS NOT NULL
        AND (l.ref LIKE 'rc:%' OR l.ref LIKE 'rcev:%')
        AND (p_platform IS NULL OR l.platform = p_platform)
    ) unioned
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_billing_product(p_id text, p_price_usd_cents integer DEFAULT NULL::integer, p_title text DEFAULT NULL::text, p_card_limit integer DEFAULT NULL::integer, p_sort_order integer DEFAULT NULL::integer, p_is_active boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.billing_products;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_price_usd_cents IS NOT NULL AND p_price_usd_cents < 0 THEN
    RAISE EXCEPTION 'price_usd_cents must be >= 0' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_card_limit IS NOT NULL AND p_card_limit < 0 THEN
    RAISE EXCEPTION 'card_limit must be >= 0' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE public.billing_products AS bp SET
    price_usd_cents   = COALESCE(p_price_usd_cents, bp.price_usd_cents),
    title             = COALESCE(p_title, bp.title),
    card_limit        = COALESCE(p_card_limit, bp.card_limit),
    sort_order        = COALESCE(p_sort_order, bp.sort_order),
    is_active         = COALESCE(p_is_active, bp.is_active),
    -- credit packs: keep the granted micro-USD == USD face value (1:1) when price changes.
    credits_micro_usd = CASE
      WHEN bp.kind = 'credit_pack' AND p_price_usd_cents IS NOT NULL
        THEN p_price_usd_cents::bigint * 10000
      ELSE bp.credits_micro_usd END
  WHERE bp.id = p_id
  RETURNING bp.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_id USING errcode = 'invalid_parameter_value';
  END IF;

  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ai_unpriced_models()
 RETURNS TABLE(provider text, model text, calls bigint, charged_micros bigint, since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT l.provider, l.model, count(*)::bigint,
           COALESCE(sum(l.price_micro_usd), 0)::bigint, min(l.created_at)
      FROM ai_cost_ledger l
     WHERE l.rate_missing
       AND l.created_at > now() - interval '30 days'
     GROUP BY l.provider, l.model
     ORDER BY 4 DESC
  $function$;

CREATE OR REPLACE FUNCTION public.charge_ai_generation(p_user_id uuid, p_job_ref text, p_provider text, p_model text, p_tokens_in integer, p_tokens_out integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j public.ai_generation_jobs%ROWTYPE;
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false; v_estimated boolean := false;
  v_cost_usd bigint; v_cost_won bigint;
  v_markup numeric; v_paid_share numeric;
  v_price bigint := 0; v_margin bigint; v_bps integer; v_bal bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to charge' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN jsonb_build_object('charged', false); END IF;

  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR j.charged OR j.refunded THEN RETURN jsonb_build_object('charged', false); END IF;

  -- Quiz jobs are priced per unit by settle_ai_quiz, not per card by markup.
  IF j.job_kind IN ('quiz_generate', 'quiz_grade') THEN
    RETURN jsonb_build_object('charged', false, 'reason', 'quiz_uses_settle');
  END IF;

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_markup := 10000.0 / GREATEST(1, 10000 - s.target_margin_bps);
  v_paid_share := CASE
    WHEN j.image_jobs > 0 THEN 1.0
    WHEN (j.free_cards + j.paid_cards) = 0 THEN 0
    ELSE j.paid_cards::numeric / (j.free_cards + j.paid_cards)
  END;

  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    v_estimated := true;
    v_cost_won := NULL;
  ELSE
    SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
    IF NOT FOUND OR v_in IS NULL THEN
      v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
    END IF;
    v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
    v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  END IF;

  -- THE CHANGE. A job that agreed a price at reserve time is billed that price; the token
  -- arithmetic above still ran, and still lands in the ledger, but it no longer decides what
  -- the learner pays.
  IF j.fixed_price_micro IS NOT NULL THEN
    v_price := j.fixed_price_micro;
  ELSIF NOT v_estimated THEN
    v_price := round(v_cost_won * v_paid_share * v_markup)::bigint;
  END IF;

  v_margin := CASE WHEN v_cost_won IS NOT NULL THEN v_price - v_cost_won END;
  v_bps    := CASE WHEN v_price > 0 AND v_margin IS NOT NULL
                   THEN (v_margin * 10000 / v_price)::integer END;

  INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
      cost_usd_micros, cost_micro_usd, price_micro_usd, margin_micro_usd, margin_bps,
      rate_missing, estimated, under_target)
    VALUES (p_job_ref, p_user_id, p_provider, p_model,
      COALESCE(p_tokens_in, 0), COALESCE(p_tokens_out, 0),
      v_cost_usd, v_cost_won, v_price, v_margin, v_bps,
      v_missing, v_estimated, (v_bps IS NOT NULL AND v_bps < s.target_margin_bps))
    ON CONFLICT (job_ref) DO NOTHING;

  IF v_price > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_price, updated_at = now()
      WHERE user_id = p_user_id RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (p_user_id, -v_price, 'spend', p_job_ref, v_bal);
    END IF;
  END IF;

  UPDATE ai_generation_jobs SET price_micro_usd = v_price, charged = true WHERE id = p_job_ref;
  RETURN jsonb_build_object('charged', true, 'price_micro_usd', v_price, 'estimated', v_estimated, 'balance', v_bal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clawback_credits(p_merchant_uid text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_intent  payment_intents%ROWTYPE;
  v_already bigint;
  v_claw    bigint;
  v_bal     bigint;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to claw back credits' USING errcode = '42501';
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_intent.kind <> 'credit_pack' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_credit_pack');
  END IF;

  IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'refund:' || p_merchant_uid) THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;

  IF v_intent.status NOT IN ('paid','refunded') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_paid', 'status', v_intent.status);
  END IF;

  IF v_intent.amount_micro_usd IS NULL OR v_intent.amount_micro_usd <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_amount');
  END IF;

  -- Already-refunded total for this intent (full + any partials).
  SELECT COALESCE(-SUM(delta), 0) INTO v_already
  FROM ai_credit_ledger
  WHERE user_id = v_intent.user_id AND reason = 'refund'
    AND (ref = 'refund:' || p_merchant_uid OR ref LIKE 'refund:' || p_merchant_uid || ':%');

  v_claw := GREATEST(v_intent.amount_micro_usd - v_already, 0);
  IF v_claw > 0 THEN
    INSERT INTO ai_credit_balance (user_id, balance)
      VALUES (v_intent.user_id, -v_claw)
      ON CONFLICT (user_id) DO UPDATE
        SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
      RETURNING balance INTO v_bal;
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (v_intent.user_id, -v_claw, 'refund', 'refund:' || p_merchant_uid, v_bal);
  ELSE
    -- Nothing left to claw (already fully refunded via partials) — still stamp the full ref
    -- so a redelivery is idempotent, and flip the intent to refunded.
    SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id = v_intent.user_id;
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (v_intent.user_id, 0, 'refund', 'refund:' || p_merchant_uid, COALESCE(v_bal, 0));
  END IF;

  UPDATE payment_intents SET status = 'refunded' WHERE merchant_uid = p_merchant_uid;

  RETURN json_build_object(
    'ok', true, 'clawed_micro', v_claw,
    'user_id', v_intent.user_id, 'balance_micro', v_bal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clawback_credits_partial(p_merchant_uid text, p_amount_micro bigint, p_ref text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_intent  payment_intents%ROWTYPE;
  v_already bigint;
  v_claw    bigint;
  v_bal     bigint;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to claw back credits' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'no_ref');
  END IF;
  IF p_amount_micro IS NULL OR p_amount_micro <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_amount');
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_intent.kind <> 'credit_pack' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_credit_pack');
  END IF;

  -- Idempotent on THIS cancel ref.
  IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'refund:' || p_ref) THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;
  IF v_intent.amount_micro_usd IS NULL OR v_intent.amount_micro_usd <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_amount');
  END IF;

  SELECT COALESCE(-SUM(delta), 0) INTO v_already
  FROM ai_credit_ledger
  WHERE user_id = v_intent.user_id AND reason = 'refund'
    AND (ref = 'refund:' || p_merchant_uid OR ref LIKE 'refund:' || p_merchant_uid || ':%');

  v_claw := LEAST(p_amount_micro, GREATEST(v_intent.amount_micro_usd - v_already, 0));
  IF v_claw <= 0 THEN
    RETURN json_build_object('ok', true, 'clawed_micro', 0, 'capped', true);
  END IF;

  INSERT INTO ai_credit_balance (user_id, balance)
    VALUES (v_intent.user_id, -v_claw)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_intent.user_id, -v_claw, 'refund', 'refund:' || p_ref, v_bal);

  IF v_already + v_claw >= v_intent.amount_micro_usd THEN
    UPDATE payment_intents SET status = 'refunded' WHERE merchant_uid = p_merchant_uid;
  END IF;

  RETURN json_build_object(
    'ok', true, 'clawed_micro', v_claw, 'user_id', v_intent.user_id, 'balance_micro', v_bal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_payment(p_merchant_uid text, p_provider text, p_provider_payment_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_intent payment_intents%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment' USING errcode = '42501';
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment intent: %', p_merchant_uid
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- IDEMPOTENT / TERMINAL-SAFE: any non-pending intent is already resolved → no-op.
  IF v_intent.status <> 'pending' THEN
    RETURN json_build_object('ok', true, 'already', true, 'status', v_intent.status,
                             'kind', v_intent.kind, 'user_id', v_intent.user_id);
  END IF;

  IF v_intent.kind = 'credit_pack' THEN
    UPDATE payment_intents
       SET status              = 'paid',
           provider            = p_provider,
           provider_payment_id = p_provider_payment_id,
           paid_at             = now()
     WHERE merchant_uid = p_merchant_uid;
    PERFORM public.add_ai_credits(
      v_intent.user_id, v_intent.amount_micro_usd, 'purchase', v_intent.merchant_uid);
    RETURN json_build_object('ok', true, 'kind', v_intent.kind, 'user_id', v_intent.user_id);

  ELSIF v_intent.kind = 'subscription' THEN
    RETURN public.activate_subscription_from_intent(
      v_intent.merchant_uid, p_provider, v_intent.merchant_uid, NULL);

  ELSE
    RAISE EXCEPTION 'Unsupported intent kind: %', v_intent.kind
      USING errcode = 'invalid_parameter_value';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_payment_intent(p_product_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_kind         text;
  v_title        text;
  v_price_krw    integer;
  v_credits      bigint;
  v_micro_won    bigint;
  v_merchant_uid text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  SELECT kind, title, price_krw, credits_micro_usd
    INTO v_kind, v_title, v_price_krw, v_credits
  FROM billing_products
  WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive product: %', p_product_id
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND product_id = p_product_id
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Already subscribed to this plan' USING errcode = 'invalid_parameter_value';
  END IF;

  -- (P-H5) A live LemonSqueezy (Merchant-of-Record) subscriber must NEVER open a fresh
  -- subscription checkout to switch plans — LS would start a SECOND, independently-billed
  -- subscription (the old one keeps auto-renewing externally) → concurrent double-charge.
  -- Plan changes for LS go through the customer portal (subscription_updated →
  -- sync_subscription_plan, SAME sub id). Block a new subscription intent here. (Other
  -- providers renew from LOCAL rows, so a superseding intent is safe and is not blocked.)
  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND provider = 'lemonsqueezy'
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Change your plan from the billing portal' USING errcode = 'invalid_parameter_value';
  END IF;

  v_micro_won := CASE WHEN v_kind = 'credit_pack' THEN v_credits ELSE NULL END;

  -- (P-M3) A subscription checkout must not mint a SECOND chargeable intent for the same
  -- plan (two tabs / double-submit → double charge). Reuse an existing pending one.
  IF v_kind = 'subscription' THEN
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NOT NULL THEN
      RETURN json_build_object(
        'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
        'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_won, 'title', v_title,
        'reused', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, amount_micro_usd)
    VALUES (v_uid, p_product_id, v_kind, v_price_krw, v_micro_won)
    RETURNING merchant_uid INTO v_merchant_uid;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent create won the pending slot — return its intent (no second charge).
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NULL THEN
      RAISE EXCEPTION 'Could not open a payment intent' USING errcode = 'invalid_parameter_value';
    END IF;
    RETURN json_build_object(
      'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
      'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_won, 'title', v_title,
      'reused', true);
  END;

  RETURN json_build_object(
    'merchant_uid',     v_merchant_uid,
    'product_id',       p_product_id,
    'kind',             v_kind,
    'amount_krw',       v_price_krw,
    'amount_micro_usd', v_micro_won,
    'title',            v_title
  );
END;
$function$;

-- `get_ai_margin_daily` returns a TABLE whose OUTPUT column names are being renamed, and
-- CREATE OR REPLACE cannot change those. It has to be dropped — which silently discards its
-- grants, so they are restated immediately after. The grantees were read from `proacl` before
-- the drop: authenticated, service_role (postgres owns it).
DROP FUNCTION IF EXISTS public.get_ai_margin_daily(p_since date);
CREATE OR REPLACE FUNCTION public.get_ai_margin_daily(p_since date DEFAULT ((now() - '30 days'::interval))::date)
 RETURNS TABLE(day date, provider text, model text, job_kind text, jobs bigint, unknown_cost_jobs bigint, rate_missing_jobs bigint, under_target_jobs bigint, net_negative_jobs bigint, price_micro_usd numeric, cost_micro_usd numeric, margin_micro_usd numeric, realized_margin_ratio numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    date_trunc('day', l.created_at)::date AS day,
    l.provider, l.model, j.job_kind,
    count(*)::bigint,
    count(*) FILTER (WHERE l.estimated)::bigint,
    count(*) FILTER (WHERE l.rate_missing)::bigint,
    count(*) FILTER (WHERE l.under_target)::bigint,
    count(*) FILTER (WHERE NOT l.estimated AND l.price_micro_usd > 0
                       AND l.margin_micro_usd < 0)::bigint,
    COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_micro_usd END)
             FILTER (WHERE NOT l.estimated), 0)::numeric,
    COALESCE(sum(l.cost_micro_usd) FILTER (WHERE NOT l.estimated), 0)::numeric,
    (COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_micro_usd END)
              FILTER (WHERE NOT l.estimated), 0)
     - COALESCE(sum(l.cost_micro_usd) FILTER (WHERE NOT l.estimated), 0))::numeric,
    round(1.0 - (COALESCE(sum(l.cost_micro_usd) FILTER (WHERE NOT l.estimated), 0))::numeric
          / NULLIF(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_micro_usd END)
                   FILTER (WHERE NOT l.estimated), 0), 4)
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE l.created_at::date >= p_since
  GROUP BY 1, 2, 3, 4
  ORDER BY 1 DESC, 2, 3, 4;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_ai_margin_daily(p_since date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_margin_daily(p_since date) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_billing_products()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT id, kind, title, price_krw, price_usd_cents, credits_micro_usd,
           tier, card_limit, period, sort_order, is_active
    FROM billing_products
    WHERE is_active
    ORDER BY sort_order, id
  ) p;
$function$;

CREATE OR REPLACE FUNCTION public.get_billing_products(p_platform text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT bp.id, bp.kind, bp.title, bp.price_krw, bp.price_usd_cents, bp.credits_micro_usd,
           bp.tier, bp.card_limit, bp.period, bp.sort_order, bp.is_active,
           sku.store_product_id
    FROM billing_products bp
    LEFT JOIN LATERAL (
      SELECT s.store_product_id
      FROM billing_product_skus s
      WHERE s.product_id = bp.id AND s.platform = p_platform AND s.is_active
      LIMIT 1
    ) sku ON true
    WHERE bp.is_active
    ORDER BY bp.sort_order, bp.id
  ) p;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_ai_est_price()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_new bigint;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  SELECT (sum(l.price_micro_usd) / NULLIF(sum(j.paid_cards), 0))::bigint INTO v_new
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE NOT l.estimated AND l.price_micro_usd > 0 AND j.paid_cards > 0
    AND l.created_at > now() - interval '30 days';
  IF v_new IS NOT NULL AND v_new > 0 THEN
    UPDATE ai_pricing_settings SET est_price_per_card_micro = v_new, updated_at = now() WHERE id = 1;
  END IF;
  RETURN COALESCE(v_new, (SELECT est_price_per_card_micro FROM ai_pricing_settings WHERE id = 1));
END;
$function$;

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
  v_delivered_units integer;
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
  v_delivered_units := LEAST(j.quiz_units_held,
                             GREATEST(0, COALESCE(p_delivered, 0)) * COALESCE(v_units_each, 1));

  -- Re-run the same allocation over the delivered units, using the split this job
  -- already holds. Free and trial units come off first, so an under-delivery gives
  -- back paid units before free ones — in the learner's favour.
  SELECT * INTO v_alloc FROM _ai_quiz_allocate(v_delivered_units, j.quiz_trial_held, j.quiz_free_held);
  v_price := v_alloc.paid_units::bigint * j.quiz_unit_price;

  -- Return the undelivered free side.
  IF j.quiz_trial_held - v_alloc.trial_units > 0 THEN
    UPDATE ai_quiz_trial
       SET units_remaining = units_remaining + (j.quiz_trial_held - v_alloc.trial_units)
     WHERE user_id = p_user_id;
  END IF;
  UPDATE ai_generation_usage
     SET free_quiz_units_used = GREATEST(0, free_quiz_units_used - (j.quiz_free_held - v_alloc.free_units)),
         paid_quiz_units_used = GREATEST(0, paid_quiz_units_used
                                  - ((j.quiz_units_held - j.quiz_free_held - j.quiz_trial_held)
                                     - v_alloc.paid_units))
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
                            'paid_units', v_alloc.paid_units, 'price_micro', v_price,
                            'balance', v_bal);
END;
$function$;

-- Two more, found by looking at RETURN TYPES rather than function bodies: their OUTPUT column
-- names carried the old spelling even though their bodies did not. `get_ai_wallet` is the one
-- every client reads the balance from, so this is the rename that reaches the screen.
DROP FUNCTION IF EXISTS public.get_ai_wallet();
DROP FUNCTION IF EXISTS public.preview_ai_cost(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_ai_wallet()
 RETURNS TABLE(balance_micro_usd bigint, est_price_per_card_micro bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY SELECT
    COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0)::bigint,
    public._ai_est_price_per_card();
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_ai_cost(p_provider text, p_model text, p_tokens_in integer, p_tokens_out integer)
 RETURNS TABLE(cost_usd_micros bigint, cost_micro_usd bigint, price_micro_usd bigint, margin_micro_usd bigint, margin_bps integer, rate_missing boolean, estimated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint; v_cost_won bigint; v_markup numeric; v_price bigint; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    RETURN QUERY SELECT NULL::bigint, NULL::bigint, 0::bigint, NULL::bigint, NULL::integer, false, true;
    RETURN;
  END IF;
  SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
  IF NOT FOUND OR v_in IS NULL THEN
    v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
  END IF;
  v_markup   := 10000.0 / GREATEST(1, 10000 - s.target_margin_bps);
  v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
  v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  v_price    := round(v_cost_won * v_markup)::bigint;   -- fully-paid price (paid_share = 1)
  v_margin   := v_price - v_cost_won;
  v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;
  RETURN QUERY SELECT v_cost_usd, v_cost_won, v_price, v_margin, v_bps, v_missing, false;
END;
$function$;


REVOKE EXECUTE ON FUNCTION public.get_ai_wallet() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.preview_ai_cost(text, text, integer, integer) TO authenticated, service_role;

-- ── the last of it: JSON keys and a local variable ─────────────────────────
--
-- Three names that are not columns and so were invisible to the column sweep: the
-- `balance_micro_won` key `get_ai_wallet_summary` returns (which every wallet display on both
-- platforms reads), the `mrr_micro_won` key in the admin billing overview, and a local variable
-- inside `create_payment_intent`. All three hold micro-USD.
--
-- NOT renamed, deliberately: `add_ai_credits(p_micro_won ...)`. PostgREST binds RPC arguments
-- BY NAME, and the only caller is the RevenueCat purchase webhook — renaming the parameter
-- breaks every purchase in the window between this migration landing and that function being
-- redeployed. It is an internal argument name, not a claim made to anyone, and the trade is bad.
DROP FUNCTION IF EXISTS public.get_ai_wallet_summary();
DROP FUNCTION IF EXISTS public.admin_billing_overview();

CREATE OR REPLACE FUNCTION public.admin_billing_overview()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    'active_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'active' AND environment IS DISTINCT FROM 'sandbox'),
    'canceling',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE cancel_at_period_end = true AND environment IS DISTINCT FROM 'sandbox'),
    'past_due',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'past_due' AND environment IS DISTINCT FROM 'sandbox'),
    'mrr_micro_usd',
      COALESCE((
        SELECT SUM(p.price_usd_cents::bigint * 10000)
        FROM billing_subscriptions s
        JOIN billing_products p ON p.id = s.product_id
        WHERE s.status = 'active' AND s.environment IS DISTINCT FROM 'sandbox'
      ), 0),
    -- The full spendable liability, test credits included — those really can be
    -- spent, so netting them out here would understate what we owe.
    'wallet_total_micro',
      COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    'paid_revenue_30d_micro',
      COALESCE((
        SELECT SUM(COALESCE(pi.amount_micro_usd, bp.price_usd_cents::bigint * 10000, 0))
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.status = 'paid' AND pi.paid_at > now() - interval '30 days'
      ), 0),
    'refunds_30d',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'refunded' AND updated_at > now() - interval '30 days'
          AND environment IS DISTINCT FROM 'sandbox'),
    -- ── sandbox, reported not hidden ──
    'sandbox_subscriptions',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE environment = 'sandbox'),
    'sandbox_granted_micro',
      COALESCE((SELECT SUM(delta) FROM ai_credit_ledger
                 WHERE environment = 'sandbox' AND delta > 0), 0),
    'sandbox_grants_enabled', public.sandbox_grants_enabled()
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_payment_intent(p_product_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_kind         text;
  v_title        text;
  v_price_krw    integer;
  v_credits      bigint;
  v_micro_usd    bigint;
  v_merchant_uid text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  SELECT kind, title, price_krw, credits_micro_usd
    INTO v_kind, v_title, v_price_krw, v_credits
  FROM billing_products
  WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive product: %', p_product_id
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND product_id = p_product_id
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Already subscribed to this plan' USING errcode = 'invalid_parameter_value';
  END IF;

  -- (P-H5) A live LemonSqueezy (Merchant-of-Record) subscriber must NEVER open a fresh
  -- subscription checkout to switch plans — LS would start a SECOND, independently-billed
  -- subscription (the old one keeps auto-renewing externally) → concurrent double-charge.
  -- Plan changes for LS go through the customer portal (subscription_updated →
  -- sync_subscription_plan, SAME sub id). Block a new subscription intent here. (Other
  -- providers renew from LOCAL rows, so a superseding intent is safe and is not blocked.)
  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND provider = 'lemonsqueezy'
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Change your plan from the billing portal' USING errcode = 'invalid_parameter_value';
  END IF;

  v_micro_usd := CASE WHEN v_kind = 'credit_pack' THEN v_credits ELSE NULL END;

  -- (P-M3) A subscription checkout must not mint a SECOND chargeable intent for the same
  -- plan (two tabs / double-submit → double charge). Reuse an existing pending one.
  IF v_kind = 'subscription' THEN
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NOT NULL THEN
      RETURN json_build_object(
        'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
        'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_usd, 'title', v_title,
        'reused', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, amount_micro_usd)
    VALUES (v_uid, p_product_id, v_kind, v_price_krw, v_micro_usd)
    RETURNING merchant_uid INTO v_merchant_uid;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent create won the pending slot — return its intent (no second charge).
    SELECT merchant_uid INTO v_merchant_uid
    FROM payment_intents
    WHERE user_id = v_uid AND product_id = p_product_id
      AND kind = 'subscription' AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_merchant_uid IS NULL THEN
      RAISE EXCEPTION 'Could not open a payment intent' USING errcode = 'invalid_parameter_value';
    END IF;
    RETURN json_build_object(
      'merchant_uid', v_merchant_uid, 'product_id', p_product_id, 'kind', v_kind,
      'amount_krw', v_price_krw, 'amount_micro_usd', v_micro_usd, 'title', v_title,
      'reused', true);
  END;

  RETURN json_build_object(
    'merchant_uid',     v_merchant_uid,
    'product_id',       p_product_id,
    'kind',             v_kind,
    'amount_krw',       v_price_krw,
    'amount_micro_usd', v_micro_usd,
    'title',            v_title
  );
END;
$function$;

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
  v_trial      integer;
  result       json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT free_cards_used, COALESCE(free_quiz_units_used, 0)
    INTO v_free_used, v_quiz_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);
  v_quiz_used := COALESCE(v_quiz_used, 0);

  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  SELECT COALESCE(units_remaining, 0) INTO v_trial FROM ai_quiz_trial WHERE user_id = v_uid;

  SELECT json_build_object(
    'balance_micro_usd',        COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    'est_price_per_card_micro', public._ai_est_price_per_card(),
    'free_limit',               v_free_limit,
    'free_used_today',          v_free_used,
    'free_remaining_today',     GREATEST(0, v_free_limit - v_free_used),
    -- Quiz runs on units, not cards, and on a separate allowance. Without these the
    -- 60-unit trial exists only inside a quote on the setup screen, where a learner
    -- who has not opened quiz can never find it.
    'quiz_unit_price_micro',      s.quiz_unit_price_micro,
    'quiz_free_limit',            s.free_quiz_units_per_day,
    'quiz_free_used_today',       v_quiz_used,
    'quiz_free_remaining_today',  GREATEST(0, s.free_quiz_units_per_day - v_quiz_used),
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


REVOKE EXECUTE ON FUNCTION public.get_ai_wallet_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet_summary() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_billing_overview() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_billing_overview() TO authenticated, service_role;

COMMENT ON FUNCTION public.add_ai_credits(uuid, bigint, text, text) IS
  'p_micro_won holds micro-USD. The name is legacy; PostgREST binds by name and the RevenueCat '
  'webhook is the only caller, so renaming it is a coordinated deploy for no user-visible gain.';

COMMIT;
