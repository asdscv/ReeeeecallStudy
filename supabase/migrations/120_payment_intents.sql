-- ============================================================================
-- 120: Payment INTENTS — server-authoritative order flow.
--
-- Closes the last self-grant hole in the mig 119 draft: the client no longer
-- shapes the money body. Instead the SERVER mints a `payment_intent` (snapshotting
-- product id, kind, and price straight from the catalog) BEFORE the provider is
-- ever invoked, and grants are only ever applied by reconciling that server row.
--
-- END-TO-END FLOW:
--   1. client calls create_payment_intent(product_id)  → server snapshots price +
--      kind from billing_products, inserts a 'pending' intent for auth.uid(),
--      returns a fresh merchant_uid.
--   2. client opens the provider checkout, passing THAT merchant_uid as the order id
--      (+ the server-snapshotted amount; provider must be told the same figure).
--   3. provider charges the card and its SERVER calls the signed payment-webhook.
--   4. payment-webhook verifies the HMAC and calls confirm_payment(merchant_uid,…),
--      which locks the intent, marks it paid (idempotently), and grants:
--        credit_pack  → add_ai_credits (mig 114, idempotent on merchant_uid)
--        subscription → grant_subscription (mig 119, idempotent on provider+ref)
--
-- Because price + kind are snapshotted server-side and grants key off the intent,
-- a client can NEVER pick its own price or self-grant. The only work left to go
-- live is a provider adapter + provider account/keys.
--
-- Additive/idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── 0) Harden the catalog shape so a mis-seeded product can't charge-but-not-grant.
-- A credit_pack MUST carry credits_micro_won (else create_payment_intent snapshots
-- NULL and confirm_payment→add_ai_credits raises → paid intent, no grant, webhook
-- 500 retry loop). A subscription MUST carry tier + card_limit. All mig-119 seeds
-- already satisfy this; the constraint just prevents a future bad row.
ALTER TABLE public.billing_products DROP CONSTRAINT IF EXISTS billing_products_kind_shape;
ALTER TABLE public.billing_products ADD CONSTRAINT billing_products_kind_shape CHECK (
  (kind = 'credit_pack'  AND credits_micro_won IS NOT NULL)
  OR (kind = 'subscription' AND tier IS NOT NULL AND card_limit IS NOT NULL)
);

-- ── 1) payment_intents — the server-authoritative order ─────────────────────
CREATE TABLE IF NOT EXISTS public.payment_intents (
  merchant_uid        text        PRIMARY KEY
                                  DEFAULT ('pi_' || replace(gen_random_uuid()::text, '-', '')),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id          text        NOT NULL REFERENCES public.billing_products(id),
  kind                text        NOT NULL,        -- snapshotted from catalog at create time
  amount_krw          integer     NOT NULL,        -- snapshotted price (whole WON)
  amount_micro_won    bigint,                      -- snapshotted credits (credit_pack only; NULL for subscription)
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','paid','failed','expired','canceled')),
  provider            text,
  provider_payment_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS payment_intents_user_status_idx
  ON public.payment_intents (user_id, status);

-- User reads their OWN intents (poll status client-side); NO client write policy →
-- inserts/updates only via the SECURITY DEFINER RPCs / service_role below.
DROP POLICY IF EXISTS "payment_intents select own" ON public.payment_intents;
CREATE POLICY "payment_intents select own"
  ON public.payment_intents FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL    ON public.payment_intents FROM anon, authenticated;
GRANT  SELECT ON public.payment_intents TO authenticated;
GRANT  ALL    ON public.payment_intents TO service_role;

-- ── 2) create_payment_intent(product_id) — client-callable, auth.uid()-scoped ─
-- Snapshots price + kind from the active catalog and opens a 'pending' intent for
-- the caller. This is what the client calls BEFORE invoking the provider. The
-- amount is taken from the SERVER catalog, never from the client.
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

  -- credit_pack snapshots the minted micro-WON; subscription has no credit amount.
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

-- ── 3) confirm_payment(...) — reconcile a paid intent. service_role / admin only ─
-- Called by the payment-webhook (service_role) once the provider's SIGNED callback
-- verifies. Locks the intent, marks it paid idempotently, then applies the grant.
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

  -- Lock the row so concurrent redeliveries serialize on it.
  SELECT * INTO v_intent
  FROM payment_intents
  WHERE merchant_uid = p_merchant_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment intent: %', p_merchant_uid
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- IDEMPOTENT: a redelivery of an already-confirmed intent is a no-op.
  IF v_intent.status = 'paid' THEN
    RETURN json_build_object('ok', true, 'already', true,
                             'kind', v_intent.kind, 'user_id', v_intent.user_id);
  END IF;

  UPDATE payment_intents
     SET status              = 'paid',
         provider            = p_provider,
         provider_payment_id = p_provider_payment_id,
         paid_at             = now()
   WHERE merchant_uid = p_merchant_uid;

  -- Apply the entitlement. Both grant helpers are themselves idempotent
  -- (add_ai_credits on merchant_uid; grant_subscription on provider+ref), so even
  -- if this txn is retried after commit the money can never be applied twice.
  IF v_intent.kind = 'credit_pack' THEN
    PERFORM public.add_ai_credits(
      v_intent.user_id, v_intent.amount_micro_won, 'purchase', v_intent.merchant_uid);
  ELSIF v_intent.kind = 'subscription' THEN
    PERFORM public.grant_subscription(
      v_intent.user_id, v_intent.product_id, p_provider, v_intent.merchant_uid, NULL);
  ELSE
    RAISE EXCEPTION 'Unsupported intent kind: %', v_intent.kind
      USING errcode = 'invalid_parameter_value';
  END IF;

  RETURN json_build_object('ok', true, 'kind', v_intent.kind, 'user_id', v_intent.user_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_payment(text, text, text) TO service_role;

-- ── 4) admin_confirm_payment(merchant_uid) — manual confirm, is_admin() only ───
-- Drives the WHOLE loop with NO provider wired up (testing / comp / support).
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_merchant_uid text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  RETURN public.confirm_payment(p_merchant_uid, 'admin', 'admin:' || p_merchant_uid);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_payment(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_confirm_payment(text) TO authenticated;
