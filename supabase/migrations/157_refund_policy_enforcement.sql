-- ============================================================================
-- 157: MACHINE-ENFORCEABLE refund policy — eligibility RPC + purchase consent.
--
-- WHY. The published policy (public/refund-policy.html) promised things the server
-- could not evaluate, and in one place the code did the OPPOSITE of the text:
--   * "no substantial use of the paid features" — undefined; an admin had to
--     eyeball it, which is not defensible in a chargeback or a KFTC complaint.
--   * "unused credits refundable / consumed credits are not" — but the only
--     clawback we own (clawback_ai_credits_by_ref, mig 134) reverses the FULL
--     granted amount and lets the wallet go negative. That is the right defensive
--     behaviour for a STORE-INITIATED refund (Apple/Google refund whatever they
--     want, whether or not we agree), but it is not "unused only", so the policy
--     text and the code disagreed.
-- This migration makes the policy a FUNCTION, so the admin UI shows a verdict with
-- a reason instead of asking a human to interpret prose.
--
-- THE POLICY THIS ENCODES (single 14-day window for the whole world):
--   * Window: 14 days from the charge. Chosen as a SUPERSET of the statutory
--     cooling-off periods we must honour anyway — Korea's 전자상거래법 7 days and
--     the EU/UK Consumer Rights 14 days — so one number satisfies every market and
--     there is no geo-detection to get wrong.
--   * Credit packs: refundable only while the pack is 100% UNUSED. One micro-WON
--     spent after the grant makes it non-refundable (the service was delivered).
--     No partial refunds.
--   * Subscriptions: refundable only on the FIRST charge, and only while the paid
--     benefit is unused — the plan's benefit is a raised owned-card cap, so
--     "unused" means the account still fits inside the FREE cap. Renewal charges
--     are out of scope (a renewal invoice ⇒ ineligible).
--   * Statutory rights still win. `statutory_note` is returned on every ineligible
--     verdict so the admin knows an override may be legally required; the RPC
--     REPORTS, it never blocks — admin-refund can still be invoked.
--
-- CONSENT (why billing_consents exists). Korea's 전자상거래법 lets us restrict
-- withdrawal for digital content ONCE USE HAS BEGUN only if that restriction was
-- disclosed BEFORE purchase; the EU equivalent needs the buyer's express consent to
-- immediate performance plus acknowledgement that the withdrawal right is lost.
-- Both are evidentiary: we must be able to show the buyer saw it. Nothing recorded
-- that today, so "used ⇒ non-refundable" was unenforceable in either market. The
-- table below is that evidence, written at purchase time.
--
-- Additive / idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE only.
-- Depends on mig 156 (platform / _billing_channel / _channel_has_money_api).
-- ============================================================================

-- ── 1) config seams — tunable without a deploy (mirrors mig 109's style) ────
CREATE OR REPLACE FUNCTION public._refund_window_days()
  RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 14 $$;
REVOKE EXECUTE ON FUNCTION public._refund_window_days() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._refund_window_days() TO authenticated, service_role;

-- The refund-policy revision the consent UI displayed. Bump when the policy text
-- changes so old consents stay attributable to the text they actually showed.
CREATE OR REPLACE FUNCTION public._refund_policy_version()
  RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '2026-07-29' $$;
REVOKE EXECUTE ON FUNCTION public._refund_policy_version() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._refund_policy_version() TO authenticated, service_role;

-- ── 2) billing_consents — pre-purchase withdrawal-right disclosure evidence ──
CREATE TABLE IF NOT EXISTS public.billing_consents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id     text        REFERENCES public.billing_products(id),
  platform       text        CHECK (platform IS NULL OR platform IN ('web','ios','android')),
  policy_version text        NOT NULL,
  merchant_uid   text,                    -- the web intent this consent belongs to (NULL for IAP)
  consented_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_consents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS billing_consents_user_time_idx
  ON public.billing_consents (user_id, consented_at DESC);
CREATE INDEX IF NOT EXISTS billing_consents_merchant_idx
  ON public.billing_consents (merchant_uid) WHERE merchant_uid IS NOT NULL;

-- The buyer may read their own consent record (it is evidence they are entitled to
-- see); writes go only through the RPC below, so a client cannot forge a timestamp.
DROP POLICY IF EXISTS "billing_consents select own" ON public.billing_consents;
CREATE POLICY "billing_consents select own"
  ON public.billing_consents FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL    ON public.billing_consents FROM anon, authenticated;
GRANT  SELECT ON public.billing_consents TO authenticated;
GRANT  ALL    ON public.billing_consents TO service_role;

-- record_purchase_consent — client-callable, auth.uid()-scoped. Called by the
-- checkout/paywall UI when the buyer ticks the disclosure box, BEFORE the provider
-- call. The server stamps the time and the policy version (never the client), so
-- the record cannot be back-dated to fit a later dispute.
CREATE OR REPLACE FUNCTION public.record_purchase_consent(
    p_product_id   text,
    p_platform     text,
    p_merchant_uid text DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_platform IS NOT NULL AND p_platform NOT IN ('web','ios','android') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform USING errcode = 'invalid_parameter_value';
  END IF;
  -- Unknown product ids are rejected: a consent that names nothing proves nothing.
  IF p_product_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM billing_products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.billing_consents
    (user_id, product_id, platform, policy_version, merchant_uid)
  VALUES
    (v_uid, p_product_id, p_platform, public._refund_policy_version(), p_merchant_uid)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'policy_version', public._refund_policy_version());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_purchase_consent(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_purchase_consent(text, text, text) TO authenticated, service_role;

-- ── 3) refund_eligibility(kind, ref) — the policy, as a verdict ─────────────
-- Admin-only, READ-ONLY. Returns:
--   {ok, eligible, reason_code, kind, channel, platform, can_refund_money,
--    purchased_at, days_since, window_days, within_window, unused,
--    consent_recorded, detail, statutory_note}
-- reason_code ∈ eligible | not_found | not_paid | already_refunded |
--               outside_window | already_used | renewal_charge
--
-- It NEVER blocks: admin-refund does not consult it. It exists so the admin sees a
-- defensible verdict and a reason next to the button, instead of guessing — and so
-- a statutory override stays a conscious, logged human decision.
CREATE OR REPLACE FUNCTION public.refund_eligibility(p_kind text, p_ref text)
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_window        integer := public._refund_window_days();
  v_user          uuid;
  v_platform      text;
  v_provider      text;
  v_channel       text;
  v_purchased_at  timestamptz;
  v_days          numeric;
  v_within        boolean;
  v_unused        boolean;
  v_consent       boolean;
  v_reason        text;
  v_detail        json;
  v_status        text;
  -- credit pack
  v_grant_at      timestamptz;
  v_granted       bigint;
  v_spent_after   bigint;
  -- subscription
  v_owned         integer;
  v_free_cap      integer;
  v_inv_total     integer;
  v_latest_reason text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason_code', 'not_found', 'eligible', false);
  END IF;

  -- ── CREDIT PACK ──────────────────────────────────────────────────────────
  IF p_kind = 'credit_pack' THEN
    -- Web pack: an intent row + a ledger grant keyed on the merchant_uid.
    SELECT pi.user_id, pi.platform, pi.provider, pi.status
      INTO v_user, v_platform, v_provider, v_status
      FROM payment_intents pi WHERE pi.merchant_uid = p_ref;

    IF NOT FOUND THEN
      -- Mobile IAP consumable: the ledger grant IS the payment (no intent row).
      SELECT l.user_id, l.platform, 'revenuecat', 'paid'
        INTO v_user, v_platform, v_provider, v_status
        FROM ai_credit_ledger l
       WHERE l.ref = p_ref AND l.delta > 0 AND l.reason = 'purchase';
      IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'reason_code', 'not_found', 'eligible', false);
      END IF;
    END IF;

    v_channel := public._billing_channel(v_platform, v_provider);

    -- The grant row carries the authoritative amount + timestamp.
    SELECT l.created_at, l.delta INTO v_grant_at, v_granted
      FROM ai_credit_ledger l
     WHERE l.ref = p_ref AND l.delta > 0 AND l.reason = 'purchase';

    v_purchased_at := COALESCE(v_grant_at,
      (SELECT pi.paid_at FROM payment_intents pi WHERE pi.merchant_uid = p_ref));

    -- Already reversed? (clawback writes ref = 'refund:'||ref — migs 127/134)
    IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'refund:' || p_ref) THEN
      v_reason := 'already_refunded';
    ELSIF v_status IS DISTINCT FROM 'paid' THEN
      v_reason := 'not_paid';
    END IF;

    -- CONSUMPTION. Any spend recorded at/after this grant counts against it.
    -- Deliberately CONSERVATIVE when a user holds several packs: the wallet is a
    -- single balance with no per-pack lots, so a spend after a LATER grant also
    -- marks EARLIER packs used. That errs toward refusing a refund we cannot prove
    -- is owed, which is the safe direction; a statutory override is still possible.
    v_spent_after := COALESCE((
      SELECT SUM(-l.delta) FROM ai_credit_ledger l
       WHERE l.user_id = v_user
         AND l.delta < 0
         AND l.reason <> 'refund'
         AND v_grant_at IS NOT NULL
         AND l.created_at >= v_grant_at), 0);
    v_unused := (v_spent_after = 0);

    v_days   := EXTRACT(EPOCH FROM (now() - v_purchased_at)) / 86400.0;
    v_within := v_purchased_at IS NOT NULL AND v_days <= v_window;

    IF v_reason IS NULL THEN
      v_reason := CASE
        WHEN NOT v_within THEN 'outside_window'
        WHEN NOT v_unused THEN 'already_used'
        ELSE 'eligible' END;
    END IF;

    v_detail := json_build_object(
      'granted_micro',      v_granted,
      'spent_since_grant',  v_spent_after,
      'intent_status',      v_status);

  -- ── SUBSCRIPTION ─────────────────────────────────────────────────────────
  ELSIF p_kind = 'subscription' THEN
    SELECT s.user_id, s.platform, s.provider, s.status, s.created_at
      INTO v_user, v_platform, v_provider, v_status, v_purchased_at
      FROM billing_subscriptions s WHERE s.id = p_ref::uuid;
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'reason_code', 'not_found', 'eligible', false);
    END IF;

    v_channel := public._billing_channel(v_platform, v_provider);

    -- First CHARGE, not first row: an admin comp grant has no invoice, and a web
    -- sub's initial invoice is the real money event. Falls back to the row's
    -- created_at, which is what mobile IAP rows have (RevenueCat writes no invoices).
    SELECT COUNT(*),
           MIN(bi.created_at),
           (SELECT b2.billing_reason FROM billing_invoices b2
             WHERE b2.provider = v_provider
               AND b2.provider_subscription_id = (
                     SELECT provider_subscription_id FROM billing_subscriptions WHERE id = p_ref::uuid)
             ORDER BY b2.created_at DESC LIMIT 1)
      INTO v_inv_total, v_grant_at, v_latest_reason
      FROM billing_invoices bi
     WHERE bi.provider = v_provider
       AND bi.provider_subscription_id = (
             SELECT provider_subscription_id FROM billing_subscriptions WHERE id = p_ref::uuid);

    v_purchased_at := COALESCE(v_grant_at, v_purchased_at);

    -- UNUSED = the paid benefit was never consumed. The benefit is a raised owned-card
    -- cap, so "unused" means the account still fits inside the FREE cap — i.e. cancelling
    -- costs the user nothing they built on top of the plan.
    v_owned    := public._owned_card_count(v_user);
    v_free_cap := public._owned_card_limit();
    v_unused   := v_owned <= v_free_cap;

    v_days   := EXTRACT(EPOCH FROM (now() - v_purchased_at)) / 86400.0;
    v_within := v_purchased_at IS NOT NULL AND v_days <= v_window;

    v_reason := CASE
      WHEN v_status = 'refunded'                     THEN 'already_refunded'
      -- A renewal was charged: out of policy scope. Detected from the invoice trail
      -- on web. Mobile IAP writes no invoices, so there it is caught by the window —
      -- the 14-day window closes long before a monthly plan can renew.
      WHEN v_latest_reason = 'renewal' OR v_inv_total > 1 THEN 'renewal_charge'
      WHEN NOT v_within                              THEN 'outside_window'
      WHEN NOT v_unused                              THEN 'already_used'
      ELSE 'eligible' END;

    v_detail := json_build_object(
      'owned_cards',        v_owned,
      'free_card_limit',    v_free_cap,
      'invoice_count',      COALESCE(v_inv_total, 0),
      'latest_billing_reason', v_latest_reason,
      'subscription_status',   v_status);

  ELSE
    RAISE EXCEPTION 'Invalid refund kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;

  v_consent := EXISTS (
    SELECT 1 FROM billing_consents c
     WHERE c.user_id = v_user
       AND (c.merchant_uid = p_ref OR c.merchant_uid IS NULL)
       AND c.consented_at <= COALESCE(v_purchased_at, now()) + interval '1 hour');

  RETURN json_build_object(
    'ok',               true,
    'eligible',         v_reason = 'eligible',
    'reason_code',      v_reason,
    'kind',             p_kind,
    'platform',         v_platform,
    'channel',          v_channel,
    'can_refund_money', public._channel_has_money_api(v_channel),
    'purchased_at',     v_purchased_at,
    'days_since',       round(v_days, 1),
    'window_days',      v_window,
    'within_window',    v_within,
    'unused',           v_unused,
    -- Evidence that the buyer was shown the withdrawal-right disclosure. When FALSE
    -- the "used ⇒ non-refundable" rule is weakly supported for KR/EU buyers, so an
    -- 'already_used' verdict should be treated as advisory rather than final.
    'consent_recorded', v_consent,
    'detail',           v_detail,
    'statutory_note',
      CASE WHEN v_reason = 'eligible' THEN NULL
           ELSE 'Statutory cooling-off rights (KR 7d / EU-UK 14d) override this verdict where they apply.'
      END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refund_eligibility(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refund_eligibility(text, text) TO authenticated;
