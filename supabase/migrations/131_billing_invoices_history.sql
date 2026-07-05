-- ============================================================================
-- 131: Subscription invoice history — so "결제 내역" (payment history) includes
--      recurring RENEWAL charges, not just the initial purchase.
--
-- payment_intents records only the user-initiated FIRST purchase (credit pack or
-- new subscription). Recurring subscription renewals arrive as LS invoice webhooks
-- (subscription_payment_success), not new intents — so they were invisible. This
-- adds a billing_invoices table the webhook writes on each invoice event, and a
-- unified get_my_payment_history RPC that merges:
--     payment_intents  (initial purchases — both kinds)
--   ∪ billing_invoices (billing_reason <> 'initial' — renewals/updates only)
-- with NO double-count (the initial invoice is already shown via its intent).
--
-- Additive/idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE only.
-- ============================================================================

-- ── 1) billing_invoices — one row per LS subscription invoice ────────────────
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  provider              text        NOT NULL DEFAULT 'lemonsqueezy',
  provider_invoice_id   text        NOT NULL,          -- LS invoice id (idempotency key)
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id       uuid        REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  provider_subscription_id text,
  product_id            text        REFERENCES public.billing_products(id),
  amount_usd_cents      integer,                        -- LS invoice total_usd (USD minor)
  billing_reason        text,                           -- 'initial'|'renewal'|'updated'
  status                text        NOT NULL DEFAULT 'paid', -- 'paid'|'refunded'|…
  invoice_url           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_invoice_id)
);
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS billing_invoices_user_created_idx
  ON public.billing_invoices (user_id, created_at DESC);

-- User reads their OWN invoices; NO client write policy → writes only via the
-- service_role RPC below (the signed webhook).
DROP POLICY IF EXISTS "billing_invoices select own" ON public.billing_invoices;
CREATE POLICY "billing_invoices select own"
  ON public.billing_invoices FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL    ON public.billing_invoices FROM anon, authenticated;
GRANT  SELECT ON public.billing_invoices TO authenticated;
GRANT  ALL    ON public.billing_invoices TO service_role;

-- ── 2) record_subscription_invoice — service_role, called by lemonsqueezy-webhook.
-- Resolves user_id / our subscription id / product_id from the LS subscription id
-- (so it can't be spoofed to another user), then UPSERTs on (provider, invoice id)
-- so retries and later refund updates are idempotent. Returns {ok:false,
-- reason:'sub_not_found'} when the subscription row isn't known yet (e.g. an initial
-- invoice racing subscription_created) — the caller treats that as a no-op.
CREATE OR REPLACE FUNCTION public.record_subscription_invoice(
  p_provider                 text,
  p_provider_invoice_id      text,
  p_provider_subscription_id text,
  p_amount_usd_cents         integer,
  p_billing_reason           text,
  p_status                   text,
  p_invoice_url              text,
  p_created_at               timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub  public.billing_subscriptions%ROWTYPE;
BEGIN
  IF p_provider_invoice_id IS NULL OR p_provider_subscription_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_ids');
  END IF;

  SELECT * INTO v_sub
    FROM public.billing_subscriptions
   WHERE provider = COALESCE(p_provider, 'lemonsqueezy')
     AND provider_subscription_id = p_provider_subscription_id
   ORDER BY updated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sub_not_found');
  END IF;

  INSERT INTO public.billing_invoices AS bi (
    provider, provider_invoice_id, user_id, subscription_id, provider_subscription_id,
    product_id, amount_usd_cents, billing_reason, status, invoice_url, created_at
  ) VALUES (
    COALESCE(p_provider, 'lemonsqueezy'), p_provider_invoice_id, v_sub.user_id, v_sub.id,
    p_provider_subscription_id, v_sub.product_id, p_amount_usd_cents, p_billing_reason,
    COALESCE(p_status, 'paid'), p_invoice_url, COALESCE(p_created_at, now())
  )
  ON CONFLICT (provider, provider_invoice_id) DO UPDATE
    SET status           = COALESCE(EXCLUDED.status, bi.status),
        amount_usd_cents = COALESCE(EXCLUDED.amount_usd_cents, bi.amount_usd_cents),
        billing_reason   = COALESCE(EXCLUDED.billing_reason, bi.billing_reason),
        invoice_url      = COALESCE(EXCLUDED.invoice_url, bi.invoice_url);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Internal service-only (webhook). Must NOT be reachable by anon/authenticated —
-- else a user could inject fake invoices for any subscription id.
REVOKE EXECUTE ON FUNCTION public.record_subscription_invoice(text,text,text,integer,text,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_subscription_invoice(text,text,text,integer,text,text,text,timestamptz)
  TO service_role;

-- ── 3) get_my_payment_history — merged, paginated (keyset on created_at) ──────
-- payment_intents (initial purchases, both kinds) ∪ billing_invoices (renewals /
-- updates, NOT the initial — already shown via its intent). auth.uid()-scoped; no
-- user-id param (no IDOR). Cursor: pass the oldest created_at you've seen as p_before.
CREATE OR REPLACE FUNCTION public.get_my_payment_history(
  p_limit  int         DEFAULT 20,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ref              text,
  source           text,          -- 'order' | 'invoice'
  product_id       text,
  title            text,
  kind             text,          -- 'credit_pack' | 'subscription'
  amount_usd_cents integer,
  billing_reason   text,          -- null for orders; 'renewal'/'updated' for invoices
  status           text,
  created_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT pi.merchant_uid                    AS ref,
           'order'::text                      AS source,
           pi.product_id,
           bp.title,
           pi.kind,
           bp.price_usd_cents                 AS amount_usd_cents,
           NULL::text                         AS billing_reason,
           pi.status,
           pi.created_at
      FROM public.payment_intents pi
      JOIN public.billing_products bp ON bp.id = pi.product_id
     WHERE pi.user_id = auth.uid()
       AND pi.status IN ('paid', 'refunded')

    UNION ALL

    SELECT bi.provider_invoice_id             AS ref,
           'invoice'::text                    AS source,
           bi.product_id,
           bp2.title,
           'subscription'::text               AS kind,
           bi.amount_usd_cents,
           bi.billing_reason,
           bi.status,
           bi.created_at
      FROM public.billing_invoices bi
      LEFT JOIN public.billing_products bp2 ON bp2.id = bi.product_id
     WHERE bi.user_id = auth.uid()
       AND COALESCE(bi.billing_reason, '') <> 'initial'
  ) h
  WHERE (p_before IS NULL OR h.created_at < p_before)
  ORDER BY h.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_payment_history(int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_payment_history(int, timestamptz) TO authenticated, service_role;
