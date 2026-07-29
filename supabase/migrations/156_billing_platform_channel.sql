-- ============================================================================
-- 156: CHANNEL (platform) attribution across the billing tables.
--
-- WHY. The admin billing screens could not tell an iOS purchase from an Android
-- one. `provider` only distinguishes the GATEWAY ('lemonsqueezy' | 'toss' |
-- 'revenuecat'), and RevenueCat fronts BOTH stores — so every mobile row looked
-- identical. That matters operationally, because what an admin may DO differs by
-- store:
--     web (lemonsqueezy / toss) → we can issue the real money refund via API
--     android (Play)            → we can issue the real money refund via API
--     ios (App Store)           → Apple issues refunds; we can only revoke access
-- Without the channel on the row the admin UI cannot render the right action, and
-- mig 135's admin-refund path silently degrades to "revoke only" for BOTH stores
-- while the UI still promises a money movement.
--
-- WHY IT ISN'T DERIVABLE TODAY (and hence a stored column, not a view):
--   * The RevenueCat webhook DOES receive the store (`event.store` → APP_STORE /
--     PLAY_STORE) and already has platformFromStore(), but never persisted it.
--   * It cannot be recovered from the product either: billing_product_skus (mig
--     151) maps the credit packs to the SAME store_product_id on both platforms
--     ('ai_credit_099' etc., mig 151 seed), and the subscription store id is not
--     stored on billing_subscriptions at all. So the store is knowable ONLY at
--     webhook time — persist it there.
--
-- BACKFILL HONESTY. Web rows backfill exactly (provider ⇒ 'web'). Pre-existing
-- REVENUECAT rows are left NULL — the store was never recorded and cannot be
-- reconstructed. The admin UI renders NULL+revenuecat as "mobile (unknown)" and
-- treats it as the SAFE case (revoke-only, no money API). Mobile IAP only just
-- went live, so this affects approximately no production rows.
--
-- MOBILE CREDIT PACKS ARE NOT IN payment_intents. An IAP consumable is granted
-- straight through add_ai_credits (ledger ref 'rc:'<txn>) — the RC webhook never
-- opens a payment_intents row. So `platform` also lands on ai_credit_ledger, and
-- admin_list_payments below UNIONs those grants in; otherwise mobile credit-pack
-- purchases would be invisible in the admin payment list entirely.
--
-- WRITE PATH. Existing grant RPC signatures are NOT changed (sync_subscription_by_user,
-- add_ai_credits are called from several webhooks). Instead this adds two tiny
-- service-role setters the RevenueCat webhook calls right after a successful grant.
-- They are idempotent and never overwrite a known value with NULL.
--
-- Additive / idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── 1) platform columns ─────────────────────────────────────────────────────
-- 'web' = browser checkout (provider tells you lemonsqueezy vs toss)
-- 'ios' / 'android' = store IAP via RevenueCat
-- NULL = unknown (legacy revenuecat rows; treated as the safe/no-money-API case)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'billing_subscriptions'
                   AND column_name = 'platform') THEN
    ALTER TABLE public.billing_subscriptions ADD COLUMN platform text;
    ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_platform_chk
      CHECK (platform IS NULL OR platform IN ('web','ios','android'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'payment_intents'
                   AND column_name = 'platform') THEN
    ALTER TABLE public.payment_intents ADD COLUMN platform text;
    ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_platform_chk
      CHECK (platform IS NULL OR platform IN ('web','ios','android'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'ai_credit_ledger'
                   AND column_name = 'platform') THEN
    ALTER TABLE public.ai_credit_ledger ADD COLUMN platform text;
    ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_platform_chk
      CHECK (platform IS NULL OR platform IN ('web','ios','android'));
  END IF;
END $$;

-- ── 2) backfill — web only; revenuecat stays NULL (see header) ──────────────
UPDATE public.billing_subscriptions
   SET platform = 'web'
 WHERE platform IS NULL AND provider IN ('lemonsqueezy','toss');

UPDATE public.payment_intents
   SET platform = 'web'
 WHERE platform IS NULL AND provider IN ('lemonsqueezy','toss');

-- Ledger purchase grants: a 'rc:'/'rcev:' ref came from the RevenueCat webhook
-- (store unknown for legacy rows → left NULL); anything else was a web checkout.
UPDATE public.ai_credit_ledger
   SET platform = 'web'
 WHERE platform IS NULL
   AND delta > 0
   AND reason = 'purchase'
   AND ref IS NOT NULL
   AND ref NOT LIKE 'rc:%'
   AND ref NOT LIKE 'rcev:%';

CREATE INDEX IF NOT EXISTS billing_subscriptions_platform_idx
  ON public.billing_subscriptions (platform);
CREATE INDEX IF NOT EXISTS payment_intents_platform_idx
  ON public.payment_intents (platform);

-- ── 3) _billing_channel — the single label the admin UI switches on ─────────
-- Collapses (platform, provider) into one value so the UI never re-derives it:
--   'web_lemonsqueezy' | 'web_toss' | 'ios' | 'android' | 'mobile_unknown' | 'admin'
-- REFUNDABILITY IS A PROPERTY OF THIS VALUE — see _channel_has_money_api below.
CREATE OR REPLACE FUNCTION public._billing_channel(p_platform text, p_provider text)
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_platform = 'ios'     THEN 'ios'
    WHEN p_platform = 'android' THEN 'android'
    WHEN p_provider = 'lemonsqueezy' THEN 'web_lemonsqueezy'
    WHEN p_provider = 'toss'         THEN 'web_toss'
    WHEN p_provider = 'revenuecat'   THEN 'mobile_unknown'
    WHEN p_provider = 'admin'        THEN 'admin'
    ELSE COALESCE(p_provider, 'unknown')
  END;
$$;
REVOKE EXECUTE ON FUNCTION public._billing_channel(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._billing_channel(text, text) TO authenticated, service_role;

-- Can WE move the money for this channel from our own server?
--   web_lemonsqueezy / web_toss → yes (mig 135 admin-refund already does)
--   android                     → yes (Play Developer API; admin-refund branch)
--   ios                         → NO. Apple exposes no developer refund API.
--   mobile_unknown / admin      → NO (fail safe: never claim a refund we can't make)
CREATE OR REPLACE FUNCTION public._channel_has_money_api(p_channel text)
  RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p_channel IN ('web_lemonsqueezy','web_toss','android');
$$;
REVOKE EXECUTE ON FUNCTION public._channel_has_money_api(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._channel_has_money_api(text) TO authenticated, service_role;

-- ── 4) service-role setters the RevenueCat webhook calls after a grant ──────
-- Kept separate from the grant RPCs so no existing signature changes. Both are
-- idempotent and REFUSE to blank a known platform (COALESCE-on-write).
CREATE OR REPLACE FUNCTION public.set_subscription_platform(
    p_provider                 text,
    p_provider_subscription_id text,
    p_platform                 text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to set subscription platform' USING errcode = '42501';
  END IF;
  IF p_platform IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_platform');
  END IF;
  IF p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE public.billing_subscriptions
     SET platform = p_platform, updated_at = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
     AND platform IS DISTINCT FROM p_platform;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count, 'platform', p_platform);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_subscription_platform(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_subscription_platform(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_credit_grant_platform(p_ref text, p_platform text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to set credit grant platform' USING errcode = '42501';
  END IF;
  IF p_platform IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_platform');
  END IF;
  IF p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RAISE EXCEPTION 'ref required' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE public.ai_credit_ledger
     SET platform = p_platform
   WHERE ref = p_ref
     AND delta > 0
     AND platform IS DISTINCT FROM p_platform;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count, 'platform', p_platform);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_credit_grant_platform(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_credit_grant_platform(text, text) TO service_role;

-- ── 5) admin_list_subscriptions — now carries platform + channel ────────────
-- Body is mig 122's, VERBATIM, plus s.platform and the derived channel/refundability
-- so the client renders the right badge and the right button without re-deriving.
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
    p_status text DEFAULT NULL,
    p_limit  int  DEFAULT 50,
    p_offset int  DEFAULT 0)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT s.id, s.user_id, u.email, s.tier, s.status, s.card_limit,
           s.provider, s.provider_subscription_id, s.current_period_end,
           s.cancel_at_period_end, s.created_at, s.updated_at,
           s.platform,
           public._billing_channel(s.platform, s.provider) AS channel,
           public._channel_has_money_api(
             public._billing_channel(s.platform, s.provider)) AS can_refund_money
    FROM billing_subscriptions s
    LEFT JOIN auth.users u ON u.id = s.user_id
    WHERE p_status IS NULL OR s.status = p_status
    ORDER BY s.updated_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_subscriptions(text, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_subscriptions(text, int, int) TO authenticated;

-- ── 6) admin_list_payments — web intents UNION mobile IAP credit grants ─────
-- Body keeps mig 147's columns (incl. amount_micro) and ADDS the mobile IAP
-- consumable grants that never open a payment_intents row. The two sources cannot
-- overlap: a web credit pack's ledger ref is the merchant_uid (already an intent),
-- a mobile one is 'rc:'/'rcev:'-prefixed, and the UNION arm filters on that prefix.
-- Synthesised mobile columns: merchant_uid := ledger ref (the refund handle),
-- provider := 'revenuecat', status := 'paid' (a ledger grant only exists once the
-- store settled), amount_micro := the granted micro-USD, kind := 'credit_pack'.
-- p_platform filters the list to one channel ('web' | 'ios' | 'android'); NULL = all.
--
-- The mig 122/147 TWO-arg overload is DROPPED first: leaving it in place next to a
-- three-arg version whose third arg has a DEFAULT makes a two-named-arg PostgREST
-- call ambiguous (42725), which would break the existing admin screen.
DROP FUNCTION IF EXISTS public.admin_list_payments(integer, integer);

CREATE OR REPLACE FUNCTION public.admin_list_payments(
    p_limit    integer DEFAULT 50,
    p_offset   integer DEFAULT 0,
    p_platform text    DEFAULT NULL)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
      -- (a) web / intent-backed payments
      SELECT pi.merchant_uid, pi.user_id, u.email, pi.product_id, pi.kind,
             pi.amount_krw,
             COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0) AS amount_micro,
             pi.status, pi.provider, pi.provider_payment_id,
             pi.paid_at, pi.created_at,
             pi.platform,
             public._billing_channel(pi.platform, pi.provider) AS channel,
             public._channel_has_money_api(
               public._billing_channel(pi.platform, pi.provider)) AS can_refund_money
      FROM payment_intents pi
      LEFT JOIN auth.users u ON u.id = pi.user_id
      LEFT JOIN billing_products bp ON bp.id = pi.product_id
      WHERE p_platform IS NULL OR pi.platform = p_platform

      UNION ALL

      -- (b) mobile IAP consumable credit packs (ledger-only, no intent row)
      SELECT l.ref AS merchant_uid, l.user_id, u.email, NULL::text AS product_id,
             'credit_pack'::text AS kind,
             NULL::integer AS amount_krw,
             l.delta::bigint AS amount_micro,
             'paid'::text AS status,
             'revenuecat'::text AS provider,
             l.ref AS provider_payment_id,
             l.created_at AS paid_at, l.created_at,
             l.platform,
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_payments(integer, integer, text) TO authenticated;

-- ── 7) admin_refund_target — now reports the channel + whether money can move ──
-- Body is mig 135's, VERBATIM, plus platform/channel/can_refund_money and a
-- credit-pack fallback to the LEDGER for mobile IAP packs (which have no intent
-- row, so mig 135 returned {ok:false,'not_found'} for every mobile credit pack —
-- the admin could not act on them at all).
CREATE OR REPLACE FUNCTION public.admin_refund_target(p_kind text, p_ref text)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v         json;
  v_plat    text;
  v_chan    text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'missing_ref');
  END IF;

  IF p_kind = 'credit_pack' THEN
    SELECT pi.platform, public._billing_channel(pi.platform, pi.provider)
      INTO v_plat, v_chan
      FROM payment_intents pi WHERE pi.merchant_uid = p_ref;
    IF FOUND THEN
      SELECT json_build_object(
               'ok',                  true,
               'kind',                'credit_pack',
               'source',              'payment_intent',
               'provider',            pi.provider,
               'platform',            pi.platform,
               'channel',             v_chan,
               'can_refund_money',    public._channel_has_money_api(v_chan),
               'user_id',             pi.user_id,
               'merchant_uid',        pi.merchant_uid,
               'provider_payment_id', pi.provider_payment_id,
               'amount_krw',          pi.amount_krw,
               'status',              pi.status)
        INTO v
        FROM payment_intents pi
       WHERE pi.merchant_uid = p_ref;
      RETURN v;
    END IF;

    -- Mobile IAP consumable: the "payment" is the ledger grant itself.
    SELECT l.platform INTO v_plat
      FROM ai_credit_ledger l
     WHERE l.ref = p_ref AND l.delta > 0 AND l.reason = 'purchase';
    IF FOUND THEN
      v_chan := public._billing_channel(v_plat, 'revenuecat');
      SELECT json_build_object(
               'ok',                  true,
               'kind',                'credit_pack',
               'source',              'credit_ledger',
               'provider',            'revenuecat',
               'platform',            l.platform,
               'channel',             v_chan,
               'can_refund_money',    public._channel_has_money_api(v_chan),
               'user_id',             l.user_id,
               'merchant_uid',        l.ref,
               'provider_payment_id', l.ref,
               'amount_micro',        l.delta,
               'status',              'paid')
        INTO v
        FROM ai_credit_ledger l
       WHERE l.ref = p_ref AND l.delta > 0 AND l.reason = 'purchase';
      RETURN v;
    END IF;

    RETURN json_build_object('ok', false, 'reason', 'not_found');

  ELSIF p_kind = 'subscription' THEN
    SELECT s.platform, public._billing_channel(s.platform, s.provider)
      INTO v_plat, v_chan
      FROM billing_subscriptions s WHERE s.id = p_ref::uuid;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_found'); END IF;

    SELECT json_build_object(
             'ok',                       true,
             'kind',                     'subscription',
             'provider',                 s.provider,
             'platform',                 s.platform,
             'channel',                  v_chan,
             'can_refund_money',         public._channel_has_money_api(v_chan),
             'user_id',                  s.user_id,
             'provider_subscription_id', s.provider_subscription_id,
             'status',                   s.status,
             'latest_invoice_id', (
               SELECT bi.provider_invoice_id
                 FROM billing_invoices bi
                WHERE bi.provider = s.provider
                  AND bi.provider_subscription_id = s.provider_subscription_id
                ORDER BY bi.created_at DESC
                LIMIT 1))
      INTO v
      FROM billing_subscriptions s
     WHERE s.id = p_ref::uuid;
    RETURN v;

  ELSE
    RAISE EXCEPTION 'Invalid refund kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_refund_target(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_refund_target(text, text) TO authenticated;
