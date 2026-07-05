-- ============================================================================
-- 133: Fixes from the adversarial money-path review of the Toss integration.
--
-- (1) [MEDIUM] Double-charge guard — create_payment_intent had NO server check that
--     the user is already subscribed, so a stale tab / direct RPC could mint a 2nd
--     subscription intent → a 2nd card charge (distinct merchant_uid = distinct Toss
--     Idempotency-Key, no dedupe) while _upsert_subscription silently expired the
--     still-paid first period. Now: reject a fresh intent for a plan the user is ALREADY
--     entitled to (a genuine plan SWITCH to a DIFFERENT product is still allowed).
-- (2) [HIGH] Renew BEFORE expiry — get_due_toss_renewals only picked subs whose period
--     had ALREADY lapsed, so between expiry and the next daily cron the plan card-limit
--     dropped (excess cards archived from study) for up to ~24h each cycle. Now due =
--     within 2 days of expiry; the charge extends from the (future) period end, no gap.
-- (3) [LOW] Renewal price snapshot — renewals charged the LIVE catalog price, so a
--     price edit silently re-priced every active subscriber with no re-consent. Snapshot
--     the agreed KRW price onto the sub and charge THAT.
-- (4) [MEDIUM] Dunning idempotency — a failed renewal reused the same period-keyed
--     Idempotency-Key forever, so Toss replayed the failure and dunning could never
--     recover. Add a renewal_attempt counter to rotate the key per genuine attempt.
--
-- Additive/idempotent: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.
-- ============================================================================

-- ── columns: agreed renewal price + dunning attempt counter ───────────────────
ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS renewal_amount_krw integer;
ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS renewal_attempt    integer NOT NULL DEFAULT 0;

-- ── (1) create_payment_intent — already-subscribed guard (provider-agnostic) ──
-- Rejects a fresh subscription intent for a plan the caller is ALREADY entitled to
-- (active/grace/past_due/canceled and period not passed). A plan SWITCH to a different
-- product is still allowed. Everything else identical to mig 120.
CREATE OR REPLACE FUNCTION public.create_payment_intent(p_product_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  SELECT kind, title, price_krw, credits_micro_won
    INTO v_kind, v_title, v_price_krw, v_credits
  FROM billing_products
  WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or inactive product: %', p_product_id
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- Block re-subscribing to a plan the user already holds (accidental double-charge via
  -- a stale tab / direct call). A switch to a DIFFERENT product is still permitted.
  IF v_kind = 'subscription' AND EXISTS (
    SELECT 1 FROM billing_subscriptions
     WHERE user_id = v_uid
       AND product_id = p_product_id
       AND status IN ('active','grace','past_due','canceled')
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RAISE EXCEPTION 'Already subscribed to this plan' USING errcode = 'invalid_parameter_value';
  END IF;

  v_micro_won := CASE WHEN v_kind = 'credit_pack' THEN v_credits ELSE NULL END;

  INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, amount_micro_won)
  VALUES (v_uid, p_product_id, v_kind, v_price_krw, v_micro_won)
  RETURNING merchant_uid INTO v_merchant_uid;

  RETURN json_build_object(
    'merchant_uid',     v_merchant_uid,
    'product_id',       p_product_id,
    'kind',             v_kind,
    'amount_krw',       v_price_krw,
    'amount_micro_won', v_micro_won,
    'title',            v_title
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_payment_intent(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_payment_intent(text) TO authenticated;

-- ── (3) activate_subscription_from_intent — snapshot the agreed renewal price ─
-- Identical to mig 121 but records the intent's amount_krw onto the sub so renewals
-- charge the agreed price, not the live catalog. (LS ignores this — LS renews itself.)
CREATE OR REPLACE FUNCTION public.activate_subscription_from_intent(
    p_merchant_uid             text,
    p_provider                 text,
    p_provider_subscription_id text,
    p_period_end               timestamptz)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_intent     payment_intents%ROWTYPE;
  v_tier       text;
  v_card_limit integer;
  v_result     json;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to activate subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment intent: %', p_merchant_uid
      USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_intent.kind <> 'subscription' THEN
    RAISE EXCEPTION 'Intent % is not a subscription', p_merchant_uid
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF v_intent.status = 'pending' THEN
    UPDATE payment_intents
       SET status              = 'paid',
           provider            = p_provider,
           provider_payment_id = COALESCE(provider_payment_id, p_provider_subscription_id),
           paid_at             = now()
     WHERE merchant_uid = p_merchant_uid;
  END IF;

  SELECT tier, card_limit INTO v_tier, v_card_limit
  FROM billing_products WHERE id = v_intent.product_id;

  v_result := public._upsert_subscription(
    v_intent.user_id, v_intent.product_id, v_tier, v_card_limit,
    p_provider, p_provider_subscription_id, 'active', p_period_end, false,
    p_merchant_uid);

  -- Snapshot the agreed KRW price + reset the dunning counter for the fresh period.
  UPDATE billing_subscriptions
     SET renewal_amount_krw = v_intent.amount_krw,
         renewal_attempt    = 0
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.activate_subscription_from_intent(text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activate_subscription_from_intent(text, text, text, timestamptz)
  TO service_role;

-- ── (2)+(3)+(4) get_due_toss_renewals — renew BEFORE expiry, agreed price, attempt ──
-- Return columns changed (added renewal_attempt) → DROP+CREATE.
DROP FUNCTION IF EXISTS public.get_due_toss_renewals(int);
CREATE OR REPLACE FUNCTION public.get_due_toss_renewals(p_limit int DEFAULT 100)
RETURNS TABLE (
  subscription_id          uuid,
  user_id                  uuid,
  provider_subscription_id text,
  product_id               text,
  current_period_end       timestamptz,
  billing_key              text,
  customer_key             text,
  price_krw                integer,
  title                    text,
  user_email               text,
  renewal_attempt          integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT s.id, s.user_id, s.provider_subscription_id, s.product_id, s.current_period_end,
         c.billing_key, c.customer_key,
         COALESCE(s.renewal_amount_krw, bp.price_krw) AS price_krw,   -- agreed price, not live
         bp.title, u.email, s.renewal_attempt
    FROM billing_subscriptions s
    JOIN toss_customers   c  ON c.user_id = s.user_id
    JOIN billing_products bp ON bp.id = s.product_id
    LEFT JOIN auth.users  u  ON u.id = s.user_id
   WHERE s.provider = 'toss'
     AND s.status IN ('active','past_due')
     AND s.cancel_at_period_end = false
     AND s.current_period_end IS NOT NULL
     AND s.current_period_end <= now() + interval '2 days'   -- renew BEFORE expiry (no gap)
     AND c.billing_key IS NOT NULL
   ORDER BY s.current_period_end ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE EXECUTE ON FUNCTION public.get_due_toss_renewals(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_due_toss_renewals(int) TO service_role;

-- ── (4) bump_toss_renewal_attempt — rotate/reset the dunning idempotency counter ──
-- reset=true  → attempt=0 (after a DONE charge whose period was successfully extended)
-- reset=false → attempt+1 (after a FAILED charge → next daily retry uses a fresh Toss
--               Idempotency-Key so dunning can actually re-attempt). A DONE-but-sync-
--               failed charge does NOT bump, so the same key replays the captured
--               payment next run (never double-charges). service_role only.
CREATE OR REPLACE FUNCTION public.bump_toss_renewal_attempt(
    p_provider_subscription_id text,
    p_reset                    boolean)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE billing_subscriptions
     SET renewal_attempt = CASE WHEN p_reset THEN 0 ELSE renewal_attempt + 1 END,
         updated_at      = now()
   WHERE provider = 'toss'
     AND provider_subscription_id = p_provider_subscription_id
  RETURNING renewal_attempt;
$$;
REVOKE EXECUTE ON FUNCTION public.bump_toss_renewal_attempt(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_toss_renewal_attempt(text, boolean) TO service_role;
