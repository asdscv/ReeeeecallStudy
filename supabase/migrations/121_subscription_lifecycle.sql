-- ============================================================================
-- 121: Subscription LIFECYCLE — cancel / expire / renew / pause / refund / fail.
--
-- Migs 119/120 only handled the INITIAL grant: confirm_payment(merchant_uid,…) →
-- grant_subscription. But every ongoing lifecycle event (a renewal, a cancel, an
-- expiry, a dunning failure, a refund/chargeback) arrives from the provider keyed
-- on the PROVIDER'S subscription id — NOT our merchant_uid / provider_ref — so we
-- could never find the row to update. This migration closes that gap:
--
--   * billing_subscriptions gains provider_subscription_id (LS subscription id /
--     RevenueCat original_transaction_id) + cancel_at_period_end, and its status
--     domain widens to include past_due / paused / refunded.
--   * _owned_card_limit still grants the plan cap while the sub is paid-through:
--     status IN (active,canceled,grace,past_due) AND period not yet passed. A
--     paused/expired/refunded sub — or one whose period has passed — grants nothing.
--   * activate_subscription_from_intent — reconciles a paid INTENT into a
--     lifecycle-trackable sub row (records the provider_subscription_id so later
--     events can be matched). This is the new "first grant" path for subscriptions.
--   * sync_subscription_by_user — same UPSERT but user+product passed DIRECTLY (for
--     RevenueCat, which has no merchant_uid/intent).
--   * sync_subscription — the MAIN lifecycle entry: UPDATE-only, matched by
--     (provider, provider_subscription_id); cancel/renew/expire/pause/fail flow here.
--   * revoke_subscription — hard kill (refund / chargeback) → status='refunded'.
--   * get_my_subscription — now surfaces cancel_at_period_end + current_period_end +
--     status of the paid-through sub so the UI can render "canceling on <date>".
--   * confirm_payment gains a subscription-aware overload that routes to
--     activate_subscription_from_intent when a provider_subscription_id is known,
--     while the mig-120 3-arg (credit_pack + base subscription) is left untouched.
--
-- All writes stay server-only: SECURITY DEFINER, service_role/admin-guarded, no
-- client GRANT (except the two admin-facing support RPCs, which keep the is_admin
-- guard). Additive/idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── 1) billing_subscriptions — lifecycle columns + widened status domain ────────
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;   -- LS sub id / RC original_transaction_id
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

-- Lifecycle events match a row by (provider, provider_subscription_id).
CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_sub_idx
  ON public.billing_subscriptions (provider, provider_subscription_id);

-- Widen the status domain: add past_due (dunning/retry), paused (RC pause), refunded
-- (refund/chargeback). DROP + re-ADD the inline column CHECK from mig 119.
ALTER TABLE public.billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_status_check;
ALTER TABLE public.billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_status_check
  CHECK (status IN ('active','canceled','expired','grace','past_due','paused','refunded'));

-- ── 2) PER-USER owned-card limit — grant while paid-through ──────────────────────
-- Grant the highest plan card_limit for a sub that is still entitled:
--   status IN (active, canceled, grace, past_due)  — canceled = paid through the
--   period; grace/past_due = retry/dunning window, keep access — AND the period has
--   NOT passed (period_end IS NULL OR > now(); NULL = no known expiry = perpetual).
-- paused / expired / refunded (or any status once the period has passed) grant
-- nothing → fall back to the global card_limit_settings cap. The period_end check is
-- the safety net so a stale 'canceled'/'grace' row can't grant forever.
CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.card_limit FROM billing_subscriptions s
       WHERE s.user_id = p_owner
         AND s.status IN ('active','canceled','grace','past_due')
         AND (s.current_period_end IS NULL OR s.current_period_end > now())
         AND s.card_limit IS NOT NULL
       ORDER BY s.card_limit DESC LIMIT 1),
    (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1));
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3) _upsert_subscription — shared UPSERT keyed on (provider, provider_subscription_id) ──
-- INTERNAL helper for activate_subscription_from_intent + sync_subscription_by_user.
-- Serializes per user, retires any OTHER grant-bearing row for that user (so the
-- one-active-per-user index holds), then UPDATE-or-INSERT the row for this provider
-- subscription. Idempotent: a redelivery updates the same row in place.
CREATE OR REPLACE FUNCTION public._upsert_subscription(
    p_user                     uuid,
    p_product_id               text,
    p_tier                     text,
    p_card_limit               integer,
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean,
    p_provider_ref             text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Same lock key as grant_subscription (mig 119) so the two paths serialize per user.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 77));

  -- Retire every OTHER grant-bearing row for this user (incl. legacy grant_subscription
  -- rows whose provider_subscription_id is NULL) so only this subscription stays active.
  -- IS DISTINCT FROM keeps it null-safe (a NULL provider_subscription_id still counts as
  -- "not this one" and gets expired).
  UPDATE billing_subscriptions
     SET status = 'expired', updated_at = now()
   WHERE user_id = p_user
     AND status IN ('active','grace','canceled','past_due')
     AND (provider IS DISTINCT FROM p_provider
          OR provider_subscription_id IS DISTINCT FROM p_provider_subscription_id);

  -- UPSERT keyed on (provider, provider_subscription_id).
  UPDATE billing_subscriptions
     SET product_id           = p_product_id,
         tier                 = COALESCE(p_tier, tier, 'pro'),
         status               = p_status,
         card_limit           = p_card_limit,
         current_period_end   = p_period_end,
         cancel_at_period_end = COALESCE(p_cancel_at_period_end, false),
         provider_ref         = COALESCE(p_provider_ref, provider_ref),
         updated_at           = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO billing_subscriptions (
      user_id, product_id, tier, status, card_limit, provider, provider_ref,
      provider_subscription_id, current_period_end, cancel_at_period_end,
      created_at, updated_at)
    VALUES (
      p_user, p_product_id, COALESCE(p_tier, 'pro'), p_status, p_card_limit,
      p_provider, p_provider_ref, p_provider_subscription_id, p_period_end,
      COALESCE(p_cancel_at_period_end, false), now(), now())
    RETURNING id INTO v_id;
  END IF;

  RETURN (
    SELECT row_to_json(s) FROM (
      SELECT id, user_id, product_id, tier, status, card_limit, provider, provider_ref,
             provider_subscription_id, current_period_end, cancel_at_period_end,
             created_at, updated_at
      FROM billing_subscriptions WHERE id = v_id) s);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._upsert_subscription(
  uuid, text, text, integer, text, text, text, timestamptz, boolean, text)
  FROM PUBLIC, anon, authenticated;

-- ── 4) RPCs ─────────────────────────────────────────────────────────────────────

-- (a) activate_subscription_from_intent — reconcile a paid INTENT into a
--     lifecycle-trackable sub. service_role (webhook) / admin only.
--     Looks up the payment_intents row by merchant_uid, marks it paid if pending
--     (idempotent, like confirm_payment), reads tier+card_limit from the catalog,
--     then UPSERTs the sub as 'active' keyed on (provider, provider_subscription_id)
--     so later cancel/renew/expire events can be matched. Idempotent on redelivery.
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
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to activate subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  -- Lock the intent so concurrent redeliveries serialize on it.
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

  -- Mark paid if still pending (idempotent — a redelivery of a paid intent skips this).
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

  RETURN public._upsert_subscription(
    v_intent.user_id, v_intent.product_id, v_tier, v_card_limit,
    p_provider, p_provider_subscription_id, 'active', p_period_end, false,
    p_merchant_uid);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.activate_subscription_from_intent(text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activate_subscription_from_intent(text, text, text, timestamptz)
  TO service_role;

-- (b) sync_subscription_by_user — same UPSERT but user+product passed DIRECTLY, for
--     RevenueCat (no merchant_uid / intent). service_role / admin only.
CREATE OR REPLACE FUNCTION public.sync_subscription_by_user(
    p_user                     uuid,
    p_product_id               text,
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind       text;
  v_tier       text;
  v_card_limit integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription' USING errcode = '42501';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_status NOT IN ('active','canceled','expired','grace','past_due','paused','refunded') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT kind, tier, card_limit INTO v_kind, v_tier, v_card_limit
  FROM billing_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_kind <> 'subscription' THEN
    RAISE EXCEPTION 'Product % is not a subscription', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  RETURN public._upsert_subscription(
    p_user, p_product_id, v_tier, v_card_limit,
    p_provider, p_provider_subscription_id, p_status, p_period_end,
    p_cancel_at_period_end, NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription_by_user(
  uuid, text, text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription_by_user(
  uuid, text, text, text, text, timestamptz, boolean)
  TO service_role;

-- (c) sync_subscription — the MAIN lifecycle entry. UPDATE-ONLY the existing row
--     matched by (provider, provider_subscription_id): cancelled / expired / renewed
--     / paused / resumed / payment_failed. If no row exists → {ok:false,
--     reason:'not_found'} (never creates one — the first grant flows through
--     activate_subscription_from_intent / sync_subscription_by_user). NULL period_end
--     / cancel flag keep the current value (so a bare status flip doesn't wipe them).
--     service_role + admin (admin-facing support surface; keeps the is_admin guard).
CREATE OR REPLACE FUNCTION public.sync_subscription(
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_status NOT IN ('active','canceled','expired','grace','past_due','paused','refunded') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE billing_subscriptions
     SET status               = p_status,
         current_period_end   = COALESCE(p_period_end, current_period_end),
         cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
         updated_at           = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
   RETURNING id, user_id INTO v_id, v_user;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', p_status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  TO service_role, authenticated;   -- authenticated reaches it only past the is_admin guard

-- (d) revoke_subscription — hard kill on refund / chargeback → status='refunded'
--     immediately (drops the card-limit grant now, not at period end). Matched by
--     (provider, provider_subscription_id). service_role + admin (is_admin guarded).
CREATE OR REPLACE FUNCTION public.revoke_subscription(
    p_provider                 text,
    p_provider_subscription_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to revoke subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;

  UPDATE billing_subscriptions
     SET status = 'refunded', updated_at = now()
   WHERE provider = p_provider
     AND provider_subscription_id = p_provider_subscription_id
   RETURNING id, user_id INTO v_id, v_user;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', 'refunded');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_subscription(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revoke_subscription(text, text)
  TO service_role, authenticated;   -- authenticated reaches it only past the is_admin guard

-- ── 5) get_my_subscription — surface cancel_at_period_end + period_end + status ───
-- Returns the caller's currently-entitled sub (auth.uid()-scoped): active OR any
-- paid-through row (canceled/grace/past_due) whose period has not passed — so the UI
-- can render "canceling on <current_period_end>" / dunning state. Active is preferred
-- when several apply. Kept readable by authenticated.
CREATE OR REPLACE FUNCTION public.get_my_subscription()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT row_to_json(s)
  FROM (
    SELECT id, user_id, product_id, tier, status, card_limit,
           provider, provider_ref, provider_subscription_id,
           current_period_end, cancel_at_period_end, created_at, updated_at
    FROM billing_subscriptions
    WHERE user_id = auth.uid()
      AND status IN ('active','canceled','grace','past_due')
      AND (current_period_end IS NULL OR current_period_end > now())
    ORDER BY (status = 'active') DESC, current_period_end DESC NULLS LAST
    LIMIT 1
  ) s;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_subscription() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;

-- ── 6) confirm_payment — subscription-aware overload ─────────────────────────────
-- The mig-120 3-arg confirm_payment(merchant_uid, provider, provider_payment_id) is
-- LEFT UNTOUCHED (credit_pack → add_ai_credits; subscription → grant_subscription
-- base case) so the existing money path never breaks. This ADDITIVE 5-arg overload
-- lets a webhook that HAS the provider's subscription id route the sub through the
-- lifecycle-aware activator (recording provider_subscription_id for later
-- cancel/renew/expire matching); with no sub id it delegates to the 3-arg base case.
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_merchant_uid             text,
    p_provider                 text,
    p_provider_payment_id      text,
    p_provider_subscription_id text,
    p_period_end               timestamptz DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to confirm payment' USING errcode = '42501';
  END IF;

  IF p_provider_subscription_id IS NOT NULL AND p_provider_subscription_id <> '' THEN
    RETURN public.activate_subscription_from_intent(
      p_merchant_uid, p_provider, p_provider_subscription_id, p_period_end);
  END IF;

  -- Base case: credit_pack, or a subscription with no provider sub id yet.
  RETURN public.confirm_payment(p_merchant_uid, p_provider, p_provider_payment_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_payment(text, text, text, text, timestamptz)
  TO service_role;
