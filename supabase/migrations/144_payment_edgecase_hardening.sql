-- ============================================================================
-- 144: Payment + study EDGE-CASE hardening (audit round 3, 2026-07-20).
--
-- Closes the CONFIRMED payment findings from the study+payment edge-case audit.
-- Additive + idempotent (CREATE OR REPLACE / CREATE INDEX IF NOT EXISTS only) and
-- preserves the gated-off, fail-closed posture: every write RPC stays SECURITY
-- DEFINER, service_role/admin guarded, REVOKEd from PUBLIC/anon/authenticated.
-- Each block reproduces the CURRENT latest-wins body with ONLY the audited change.
--
--   P-H1  Retire paths (grant_subscription / _upsert_subscription / admin_cancel
--         immediate) left current_period_end in the FUTURE, so a later provider
--         event resurrected the superseded row → two 'active' rows → 23505 →
--         webhook 500 poison loop. Fix: supersede/immediate retire now sets
--         current_period_end = now() (past → the terminal guard + _owned_card_limit
--         both treat it as lapsed), AND the entitled UPDATE in sync_subscription /
--         sync_subscription_plan is wrapped in a unique_violation handler that
--         returns {ok:false, reason:'active_conflict'} (webhook ACKs 200, no loop).
--   P-H2  activate_subscription_from_intent had NO terminal guard, so a redelivered
--         first-grant webhook could flip a 'refunded' row back to 'active'. Fix:
--         lock+read the (provider, sub id) row and refuse an entitled resurrection.
--   P-M2  The mig-126/134 terminal guard folded a LAPSED 'expired' into terminal,
--         blocking a legitimate paid post-expiry RENEWAL (same sub id). Fix: a new
--         shared _sub_blocks_resurrection() — 'refunded' is ALWAYS terminal, but an
--         'expired' row is resurrectable when the INCOMING event carries a future
--         period (a real renewal) — applied to all three sync paths + activate.
--   P-L1  confirm_payment(3-arg) subscription branch (via activate) could store an
--         'active' + NULL-period PERPETUAL cap for a real provider. Fix: activate
--         derives a concrete period from the product when p_period_end IS NULL and
--         the provider is not 'admin'.
--   P-L3  confirm_payment/activate re-processed NON-pending intents (refunded→paid
--         regress; grant on an expired intent). Fix: confirm_payment short-circuits
--         on ANY non-pending status; activate refuses a non-pending/paid intent.
--   P-M3  Concurrent first-time subscribe double-charged (no unique guard spanning
--         the charge). Fix: a partial unique index on payment_intents(user_id,
--         product_id) WHERE kind='subscription' AND status='pending' + create_payment_intent
--         REUSES an existing pending intent instead of minting a second chargeable one.
--   P-H3  (DB half) Toss PARTIAL_CANCELED clawed the FULL credit-pack amount. Fix:
--         clawback_credits now caps the reversal at (granted - already-clawed), and a
--         new clawback_credits_partial() reverses only a specific refunded amount,
--         idempotent per cancel key. (The toss-webhook half gates on balanceAmount.)
--   P-L2  RevenueCat TRANSFER stranded the raised cap on the old app_user_id. Fix: a
--         new transfer_subscription() reassigns the sub row's user_id (retiring the
--         target's prior active row first). (The revenuecat-webhook half calls it.)
--   P-L4  Unlimited plan (2e9) made get_active_card_threshold a full owned-card scan
--         every study/deck load. Fix: short-circuit NULL when the limit is unlimited.
--   S-N2  get_subscribed_active_threshold's accepted_at tie could leave an over-cap
--         subscribed deck active. Fix: is_subscribed_deck_active now decides per-deck
--         from the (accepted_at, deck_id) running sum (tie-safe), not a scalar cutoff.
-- ============================================================================

-- ── 0) _sub_blocks_resurrection — shared terminal-resurrection rule (P-H2 + P-M2) ──
-- TRUE when an INCOMING entitled transition must be REFUSED because the existing row is
-- terminal. 'refunded' is ALWAYS terminal (money returned). An 'expired' row is terminal
-- only for a STALE replay — an incoming event that itself carries no future period; a real
-- post-expiry RENEWAL brings a future period and is allowed through (P-M2).
CREATE OR REPLACE FUNCTION public._sub_blocks_resurrection(
    p_cur_status text,
    p_cur_period timestamptz,
    p_new_status text,
    p_new_period timestamptz)
  RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT p_new_status IN ('active','grace','canceled','past_due')
     AND (
       p_cur_status = 'refunded'
       OR (p_cur_status = 'expired'
           AND (p_cur_period IS NULL OR p_cur_period <= now())
           AND (p_new_period IS NULL OR p_new_period <= now()))
     );
$$;
REVOKE EXECUTE ON FUNCTION public._sub_blocks_resurrection(text, timestamptz, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ── 1) grant_subscription — supersede-retire clears the period (P-H1) ──────────────
-- Reproduces mig 119 VERBATIM except the "retire the prior active" UPDATE now sets
-- status='expired' + current_period_end=now() (was 'canceled', future period kept). A
-- superseded row must be lapsed immediately so a later provider event can't resurrect it.
CREATE OR REPLACE FUNCTION public.grant_subscription(
    p_user        uuid,
    p_product_id  text,
    p_provider    text,
    p_provider_ref text,
    p_period_end  timestamptz)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind       text;
  v_tier       text;
  v_card_limit integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to grant subscription' USING errcode = '42501';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user required' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT kind, tier, card_limit INTO v_kind, v_tier, v_card_limit
  FROM billing_products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product: %', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_kind <> 'subscription' THEN
    RAISE EXCEPTION 'Product % is not a subscription', p_product_id USING errcode = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 77));

  IF p_provider IS NOT NULL AND p_provider_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM billing_subscriptions
    WHERE provider = p_provider AND provider_ref = p_provider_ref
  ) THEN
    RETURN;
  END IF;

  -- One active sub per user: retire the prior active as SUPERSEDED (expired + lapsed now),
  -- NOT 'canceled'+future — a future period would let a stale provider event resurrect it
  -- (P-H1) and would keep granting the old cap (mig 121 _owned_card_limit).
  UPDATE billing_subscriptions
     SET status = 'expired', current_period_end = now(), updated_at = now()
   WHERE user_id = p_user AND status = 'active';

  INSERT INTO billing_subscriptions (
    user_id, product_id, tier, status, card_limit,
    provider, provider_ref, current_period_end, created_at, updated_at
  ) VALUES (
    p_user, p_product_id, COALESCE(v_tier, 'pro'), 'active', v_card_limit,
    p_provider, p_provider_ref, p_period_end, now(), now()
  )
  ON CONFLICT (provider, provider_ref) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_subscription(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_subscription(uuid, text, text, text, timestamptz) TO service_role;

-- ── 2) _upsert_subscription — supersede-retire clears the period (P-H1) ────────────
-- Reproduces mig 121 VERBATIM except the OTHER-row retire now also sets
-- current_period_end=now() so a superseded row is lapsed (terminal-guard catchable).
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
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 77));

  UPDATE billing_subscriptions
     SET status = 'expired', current_period_end = now(), updated_at = now()
   WHERE user_id = p_user
     AND status IN ('active','grace','canceled','past_due')
     AND (provider IS DISTINCT FROM p_provider
          OR provider_subscription_id IS DISTINCT FROM p_provider_subscription_id);

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

-- ── 3) admin_cancel_subscription — immediate cancel lapses the period (P-H1) ───────
-- Reproduces mig 122 VERBATIM except the IMMEDIATE branch also sets
-- current_period_end=now() so an immediately-expired sub can't be resurrected.
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(
    p_provider                 text,
    p_provider_subscription_id text,
    p_immediate                boolean DEFAULT false)
  RETURNS json
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_user uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  IF COALESCE(p_immediate, false) THEN
    UPDATE billing_subscriptions
       SET status = 'expired', current_period_end = now(),
           cancel_at_period_end = false, updated_at = now()
     WHERE provider = p_provider
       AND provider_subscription_id = p_provider_subscription_id
     RETURNING id, user_id INTO v_id, v_user;
  ELSE
    UPDATE billing_subscriptions
       SET status = CASE WHEN current_period_end IS NULL THEN 'expired' ELSE 'canceled' END,
           current_period_end = CASE WHEN current_period_end IS NULL THEN now() ELSE current_period_end END,
           cancel_at_period_end = (current_period_end IS NOT NULL),
           updated_at = now()
     WHERE provider = p_provider
       AND provider_subscription_id = p_provider_subscription_id
     RETURNING id, user_id INTO v_id, v_user;
  END IF;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user,
    'status', CASE WHEN COALESCE(p_immediate, false) THEN 'expired' ELSE 'canceled' END,
    'immediate', COALESCE(p_immediate, false));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_subscription(text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_subscription(text, text, boolean) TO authenticated;

-- ── 4) sync_subscription — shared terminal rule + conflict-safe UPDATE (P-H1/P-M2) ──
CREATE OR REPLACE FUNCTION public.sync_subscription(
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_user       uuid;
  v_cur_status text;
  v_cur_period timestamptz;
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

  SELECT id, user_id, status, current_period_end
    INTO v_id, v_user, v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF public._sub_blocks_resurrection(v_cur_status, v_cur_period, p_status, p_period_end) THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  -- The one-active-per-user index (mig 119) can trip if an entitled transition on a
  -- SUPERSEDED row races a legitimately-active sibling (e.g. admin comp). Catch it and
  -- ACK (ok:false) instead of throwing — a thrown 23505 would 500 the webhook forever (P-H1).
  BEGIN
    UPDATE billing_subscriptions
       SET status               = p_status,
           current_period_end   = COALESCE(p_period_end, current_period_end),
           cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
           updated_at           = now()
     WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'active_conflict', 'id', v_id);
  END;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', p_status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  TO service_role, authenticated;

-- ── 5) sync_subscription_plan — shared terminal rule + conflict-safe UPDATE ─────────
CREATE OR REPLACE FUNCTION public.sync_subscription_plan(
    p_provider                 text,
    p_provider_subscription_id text,
    p_product_id               text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_user       uuid;
  v_cur_status text;
  v_cur_period timestamptz;
  v_kind       text;
  v_tier       text;
  v_card_limit integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription plan' USING errcode = '42501';
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

  SELECT id, user_id, status, current_period_end
    INTO v_id, v_user, v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF public._sub_blocks_resurrection(v_cur_status, v_cur_period, p_status, p_period_end) THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  BEGIN
    UPDATE billing_subscriptions
       SET product_id           = p_product_id,
           tier                 = COALESCE(v_tier, tier, 'pro'),
           card_limit           = v_card_limit,
           status               = p_status,
           current_period_end   = COALESCE(p_period_end, current_period_end),
           cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
           updated_at           = now()
     WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'active_conflict', 'id', v_id);
  END;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', p_status,
    'product_id', p_product_id, 'card_limit', v_card_limit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription_plan(text, text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription_plan(text, text, text, text, timestamptz, boolean)
  TO service_role;

-- ── 6) sync_subscription_by_user — shared terminal rule (P-M2) ──────────────────────
-- (No unique_violation wrap needed: _upsert_subscription retires the user's sibling rows
-- BEFORE upserting, so the one-active index cannot trip here.)
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
  v_cur_status text;
  v_cur_period timestamptz;
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

  SELECT status, current_period_end INTO v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF FOUND AND public._sub_blocks_resurrection(v_cur_status, v_cur_period, p_status, p_period_end) THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
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

-- ── 7) activate_subscription_from_intent — terminal guard + non-pending refusal +
--      NULL-period derivation (P-H2 / P-L3 / P-L1) ─────────────────────────────────
-- Reproduces mig 133 (which snapshots renewal price) plus: (a) refuse if the intent is
-- not pending/paid (P-L3); (b) refuse an entitled resurrection of a terminal (provider,
-- sub id) row (P-H2); (c) when p_period_end IS NULL and the provider is not 'admin',
-- derive a concrete period from the product's period so a real sub is never perpetual (P-L1).
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
  v_period     text;
  v_cur_status text;
  v_cur_period timestamptz;
  v_period_end timestamptz := p_period_end;
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

  -- (P-L3) Never grant off a NON-pending/paid intent (e.g. one swept to 'expired', or a
  -- refunded one) — a late/duplicate event must not resurrect a grant for a dead intent.
  IF v_intent.status NOT IN ('pending','paid') THEN
    RETURN json_build_object('ok', false, 'reason', 'intent_' || v_intent.status);
  END IF;

  -- (P-H2) Terminal guard on the existing (provider, sub id) row: a redelivered first-grant
  -- must not resurrect a refunded (or stale-expired) subscription. A fresh subscribe uses a
  -- NEW sub id → no row → not terminal → proceeds.
  SELECT status, current_period_end INTO v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;
  IF FOUND AND public._sub_blocks_resurrection(v_cur_status, v_cur_period, 'active', v_period_end) THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  IF v_intent.status = 'pending' THEN
    UPDATE payment_intents
       SET status              = 'paid',
           provider            = p_provider,
           provider_payment_id = COALESCE(provider_payment_id, p_provider_subscription_id),
           paid_at             = now()
     WHERE merchant_uid = p_merchant_uid;
  END IF;

  SELECT tier, card_limit, period INTO v_tier, v_card_limit, v_period
  FROM billing_products WHERE id = v_intent.product_id;

  -- (P-L1) A real provider sub must carry a concrete expiry. When none was supplied and the
  -- provider is not the admin-comp channel, derive it from the product's billing period so
  -- the row is never an 'active' + NULL-period PERPETUAL grant.
  IF v_period_end IS NULL AND p_provider <> 'admin' THEN
    v_period_end := now() + CASE lower(COALESCE(v_period, 'month'))
                              WHEN 'year'  THEN interval '1 year'
                              WHEN 'week'  THEN interval '1 week'
                              ELSE interval '1 month'
                            END;
  END IF;

  v_result := public._upsert_subscription(
    v_intent.user_id, v_intent.product_id, v_tier, v_card_limit,
    p_provider, p_provider_subscription_id, 'active', v_period_end, false,
    p_merchant_uid);

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

-- ── 8) confirm_payment (3-arg) — short-circuit on ANY non-pending intent (P-L3) ─────
-- Reproduces mig 134 VERBATIM except the idempotency short-circuit now fires for ANY
-- non-'pending' status (paid/refunded/expired/canceled/failed), so a redelivery can no
-- longer regress a refunded intent to 'paid' or re-run a grant for a dead intent.
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_merchant_uid        text,
    p_provider            text,
    p_provider_payment_id text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
      v_intent.user_id, v_intent.amount_micro_won, 'purchase', v_intent.merchant_uid);
    RETURN json_build_object('ok', true, 'kind', v_intent.kind, 'user_id', v_intent.user_id);

  ELSIF v_intent.kind = 'subscription' THEN
    RETURN public.activate_subscription_from_intent(
      v_intent.merchant_uid, p_provider, v_intent.merchant_uid, NULL);

  ELSE
    RAISE EXCEPTION 'Unsupported intent kind: %', v_intent.kind
      USING errcode = 'invalid_parameter_value';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_payment(text, text, text) TO service_role;

-- ── 9) payment_intents — one pending SUBSCRIPTION intent per (user, product) (P-M3) ─
-- Backstop against a concurrent double-subscribe minting two chargeable intents. A second
-- pending subscription intent for the same plan collides; create_payment_intent (below)
-- reuses the existing pending intent so the common retry/second-tab case is seamless.
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_pending_sub_per_product
  ON public.payment_intents (user_id, product_id)
  WHERE kind = 'subscription' AND status = 'pending';

-- ── 10) create_payment_intent — REUSE a pending subscription intent (P-M3) ─────────
-- Reproduces mig 133 VERBATIM except: for a subscription, return an EXISTING pending intent
-- for this (user, product) instead of minting a second chargeable one, and if a concurrent
-- insert races the unique index, re-read and return the winner. No double-charge, no lockout.
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
        'amount_krw', v_price_krw, 'amount_micro_won', v_micro_won, 'title', v_title,
        'reused', true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO payment_intents (user_id, product_id, kind, amount_krw, amount_micro_won)
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
      'amount_krw', v_price_krw, 'amount_micro_won', v_micro_won, 'title', v_title,
      'reused', true);
  END;

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

-- ── 11) clawback_credits — cap the reversal at (granted - already-clawed) (P-H3) ────
-- Reproduces mig 127 VERBATIM except it now subtracts amounts already refunded (full or
-- partial, keyed by 'refund:<merchant_uid>' or 'refund:<merchant_uid>:*') so a FULL cancel
-- after a partial can't over-claw. Idempotent on 'refund:<merchant_uid>'.
CREATE OR REPLACE FUNCTION public.clawback_credits(p_merchant_uid text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  IF v_intent.amount_micro_won IS NULL OR v_intent.amount_micro_won <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_amount');
  END IF;

  -- Already-refunded total for this intent (full + any partials).
  SELECT COALESCE(-SUM(delta), 0) INTO v_already
  FROM ai_credit_ledger
  WHERE user_id = v_intent.user_id AND reason = 'refund'
    AND (ref = 'refund:' || p_merchant_uid OR ref LIKE 'refund:' || p_merchant_uid || ':%');

  v_claw := GREATEST(v_intent.amount_micro_won - v_already, 0);
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
$$;
REVOKE EXECUTE ON FUNCTION public.clawback_credits(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clawback_credits(text) TO service_role;

-- ── 12) clawback_credits_partial — reverse a SPECIFIC refunded amount (P-H3) ────────
-- For a PARTIAL_CANCELED credit-pack refund: reverse only p_amount_micro, idempotent per
-- p_ref (the provider cancel key). Caps the running total at the granted amount, and flips
-- the intent to 'refunded' only once fully reversed. service_role/admin.
CREATE OR REPLACE FUNCTION public.clawback_credits_partial(
    p_merchant_uid  text,
    p_amount_micro  bigint,
    p_ref           text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
  IF v_intent.amount_micro_won IS NULL OR v_intent.amount_micro_won <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_amount');
  END IF;

  SELECT COALESCE(-SUM(delta), 0) INTO v_already
  FROM ai_credit_ledger
  WHERE user_id = v_intent.user_id AND reason = 'refund'
    AND (ref = 'refund:' || p_merchant_uid OR ref LIKE 'refund:' || p_merchant_uid || ':%');

  v_claw := LEAST(p_amount_micro, GREATEST(v_intent.amount_micro_won - v_already, 0));
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

  IF v_already + v_claw >= v_intent.amount_micro_won THEN
    UPDATE payment_intents SET status = 'refunded' WHERE merchant_uid = p_merchant_uid;
  END IF;

  RETURN json_build_object(
    'ok', true, 'clawed_micro', v_claw, 'user_id', v_intent.user_id, 'balance_micro', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clawback_credits_partial(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.clawback_credits_partial(text, bigint, text) TO service_role;

-- ── 13) transfer_subscriptions_by_user — move a user's subs on TRANSFER (P-L2) ──────
-- A RevenueCat TRANSFER event names the FROM/TO app_user_ids (not a sub id), so the raised
-- cap must follow the user. Moves every one of p_from_user's rows for this provider to
-- p_to_user, retiring p_to_user's prior active row first so the one-active index holds.
-- Idempotent (from = to → no-op). service_role/admin. (RC has ≤1 active sub per user.)
CREATE OR REPLACE FUNCTION public.transfer_subscriptions_by_user(
    p_provider  text,
    p_from_user uuid,
    p_to_user   uuid)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_moved int;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to transfer subscription' USING errcode = '42501';
  END IF;
  IF p_from_user IS NULL OR p_to_user IS NULL OR p_provider IS NULL THEN
    RAISE EXCEPTION 'provider, from_user and to_user required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_from_user = p_to_user THEN
    RETURN json_build_object('ok', true, 'already', true, 'moved', 0);
  END IF;

  -- Lock BOTH users (ordered) so a concurrent transfer/grant can't race the one-active slot.
  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(p_from_user, p_to_user)::text, 77));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(p_from_user, p_to_user)::text, 77));

  -- Retire the target's prior active row so an incoming active row can hold the slot.
  UPDATE billing_subscriptions
     SET status = 'expired', current_period_end = now(), updated_at = now()
   WHERE user_id = p_to_user AND status = 'active';

  WITH moved AS (
    UPDATE billing_subscriptions
       SET user_id = p_to_user, updated_at = now()
     WHERE user_id = p_from_user AND provider = p_provider
     RETURNING 1)
  SELECT count(*) INTO v_moved FROM moved;

  RETURN json_build_object('ok', true, 'moved', v_moved, 'from_user', p_from_user, 'to_user', p_to_user);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.transfer_subscriptions_by_user(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_subscriptions_by_user(text, uuid, uuid) TO service_role;

-- ── 14) get_active_card_threshold — short-circuit NULL for the unlimited plan (P-L4) ─
-- Unlimited (card_limit >= 1e9) can NEVER be over the cap, so the threshold is always NULL —
-- but the OFFSET 2e9 form still had the executor enumerate the whole owned-card set every
-- study/deck load. Return NULL directly when the effective limit is unlimited.
CREATE OR REPLACE FUNCTION public.get_active_card_threshold()
  RETURNS timestamptz
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_limit integer := public._owned_card_limit(auth.uid());
  v_ts    timestamptz;
BEGIN
  IF v_limit >= 1000000000 THEN
    RETURN NULL;  -- unlimited → never archived; skip the full owned-card scan
  END IF;
  SELECT c.created_at INTO v_ts
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE d.user_id = auth.uid()
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    )
  ORDER BY c.created_at ASC, c.id ASC
  OFFSET GREATEST(v_limit - 1, 0)
  LIMIT 1;
  RETURN v_ts;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_card_threshold() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_card_threshold() TO authenticated;

-- ── 15) is_subscribed_deck_active — tie-safe per-deck decision (S-N2) ───────────────
-- mig 142 reduced the boundary to a scalar max(accepted_at), so two subscribed decks
-- sharing an accepted_at with the cap boundary between them could BOTH read as active.
-- Decide per-deck straight from the (accepted_at, deck_id) running sum instead: THIS deck is
-- active iff its cumulative subscribed-card total is within the remaining slots. Official
-- decks (free/uncapped) short-circuit true, exactly as before.
CREATE OR REPLACE FUNCTION public.is_subscribed_deck_active(p_deck_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = p_deck_id)
         AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false)
      THEN true
    ELSE COALESCE((
      WITH cfg AS (
        SELECT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false) AS inc_official
      ),
      lim AS (SELECT public._owned_card_limit(auth.uid()) AS n),
      owned AS (
        SELECT count(*)::int AS c
        FROM cards c JOIN decks d ON d.id = c.deck_id
        WHERE d.user_id = auth.uid()
          AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
      ),
      rem AS (SELECT GREATEST((SELECT n FROM lim) - (SELECT c FROM owned), 0) AS r),
      subs AS (
        SELECT ds.deck_id, ds.accepted_at,
          (SELECT count(*) FROM cards c JOIN decks d ON d.id = c.deck_id
            WHERE d.id = ds.deck_id
              AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id))
          ) AS cnt
        FROM deck_shares ds
        WHERE ds.recipient_id = auth.uid()
          AND ds.share_mode = 'subscribe'
          AND ds.status = 'active'
          AND ((SELECT inc_official FROM cfg) OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = ds.deck_id))
      ),
      ranked AS (
        SELECT deck_id,
          sum(cnt) OVER (ORDER BY accepted_at ASC, deck_id ASC) AS running
        FROM subs
      )
      -- Unlimited → always active. Else THIS deck is active iff its cumulative running
      -- total (tie-broken by deck_id) is within the remaining slots.
      SELECT CASE
        WHEN (SELECT n FROM lim) >= 1000000000 THEN true
        ELSE (SELECT running FROM ranked WHERE deck_id = p_deck_id) <= (SELECT r FROM rem)
      END
    ), true)
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_subscribed_deck_active(uuid) TO authenticated;
