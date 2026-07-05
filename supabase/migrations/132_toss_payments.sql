-- ============================================================================
-- 132: TossPayments (토스페이먼츠) support — a SECOND web provider alongside
--      LemonSqueezy, chosen per-checkout.
--
-- The grant/lifecycle RPCs (confirm_payment, activate_subscription_from_intent,
-- sync_subscription, revoke_subscription, record_subscription_invoice) are ALL
-- provider-agnostic (provider is free text) — Toss reuses them verbatim with
-- p_provider='toss'. This migration adds only the Toss-SPECIFIC glue the RPC layer
-- can't cover:
--   1) toss_customers — per-user Toss customerKey + billingKey (recurring). Toss has
--      no hosted subscription; WE store the billingKey and charge on a schedule.
--   2) get_or_create_toss_customer_key() — mints a stable, non-guessable customerKey
--      for the caller (needed before requestBillingAuth). Returns ONLY the customerKey,
--      never the billingKey (that stays service-role-only).
--   3) request_cancel/resume_my_subscription() — in-app cancel for TOSS subs (we own
--      the recurring charge, so cancel = stop renewing). LS subs cancel via the LS
--      customer portal, so these are guarded to provider='toss' only.
--   4) Currency-aware payment history — billing_invoices/get_my_payment_history were
--      USD-cents-only; Toss charges KRW. Adds currency + amount_krw so a Toss row shows
--      ₩ and an LS row shows $.
--
-- Additive/idempotent: CREATE TABLE/OR REPLACE + ADD COLUMN IF NOT EXISTS. The two
-- functions whose RETURN/signature shape changes (record_subscription_invoice,
-- get_my_payment_history) are DROP+CREATE (Postgres can't CREATE OR REPLACE those).
-- ============================================================================

-- ── 1) toss_customers — customerKey + billingKey per user (service-role only) ──
-- billingKey is a payment credential: NEVER exposed to the client. RLS grants no
-- client access at all; only edge functions (service_role) read/write it. The
-- customerKey is surfaced to the client solely through get_or_create_toss_customer_key.
CREATE TABLE IF NOT EXISTS public.toss_customers (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_key text        NOT NULL UNIQUE,   -- non-guessable, bound to the billingKey
  billing_key  text,                          -- Toss 빌링키 — charge credential (secret)
  card_brand   text,
  card_last4   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.toss_customers ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE policy → clients cannot touch this table at all.
REVOKE ALL ON public.toss_customers FROM anon, authenticated;
GRANT  ALL ON public.toss_customers TO service_role;

-- get_or_create_toss_customer_key — the ONE client-callable surface: returns the
-- caller's stable customerKey (mints on first call). Never returns the billingKey.
CREATE OR REPLACE FUNCTION public.get_or_create_toss_customer_key()
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  INSERT INTO toss_customers (user_id, customer_key)
  VALUES (v_uid, 'toss_cus_' || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()  -- no-op: returns the existing row
  RETURNING customer_key INTO v_key;
  RETURN v_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_toss_customer_key() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_toss_customer_key() TO authenticated;

-- ── 2) In-app cancel / resume — TOSS subscriptions only ───────────────────────
-- For Toss WE run the recurring charge, so a user cancel just flips
-- cancel_at_period_end (the renewal scheduler then skips it; access holds until the
-- period ends). Guarded to provider='toss': an LS sub must be cancelled in the LS
-- portal (LS is Merchant of Record and would keep charging otherwise).
CREATE OR REPLACE FUNCTION public.request_cancel_my_subscription()
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  UPDATE billing_subscriptions
     SET cancel_at_period_end = true, updated_at = now()
   WHERE user_id = v_uid
     AND provider = 'toss'
     AND status IN ('active','grace','past_due')
     AND (current_period_end IS NULL OR current_period_end > now())
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_cancelable_subscription');
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.request_cancel_my_subscription() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_cancel_my_subscription() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_resume_my_subscription()
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  UPDATE billing_subscriptions
     SET cancel_at_period_end = false, updated_at = now()
   WHERE user_id = v_uid
     AND provider = 'toss'
     AND status IN ('active','grace','past_due')
     AND (current_period_end IS NULL OR current_period_end > now())
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_resumable_subscription');
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.request_resume_my_subscription() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_resume_my_subscription() TO authenticated;

-- ── 3) Currency-aware payment history ─────────────────────────────────────────
-- billing_invoices was USD-cents only; Toss charges KRW. Add a currency + a KRW
-- amount so each history row can render in the currency it was charged.
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS currency   text    NOT NULL DEFAULT 'usd';
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS amount_krw integer;

-- record_subscription_invoice — re-created with p_currency + p_amount_krw (defaulted,
-- so the existing 8-named-arg LS call still resolves here → currency='usd'). DROP the
-- old 8-arg first (adding params makes a NEW overload; we want one canonical fn).
DROP FUNCTION IF EXISTS public.record_subscription_invoice(text,text,text,integer,text,text,text,timestamptz);
CREATE OR REPLACE FUNCTION public.record_subscription_invoice(
  p_provider                 text,
  p_provider_invoice_id      text,
  p_provider_subscription_id text,
  p_amount_usd_cents         integer,
  p_billing_reason           text,
  p_status                   text,
  p_invoice_url              text,
  p_created_at               timestamptz,
  p_currency                 text    DEFAULT 'usd',
  p_amount_krw               integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.billing_subscriptions%ROWTYPE;
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
    product_id, amount_usd_cents, billing_reason, status, invoice_url, created_at,
    currency, amount_krw
  ) VALUES (
    COALESCE(p_provider, 'lemonsqueezy'), p_provider_invoice_id, v_sub.user_id, v_sub.id,
    p_provider_subscription_id, v_sub.product_id, p_amount_usd_cents, p_billing_reason,
    COALESCE(p_status, 'paid'), p_invoice_url, COALESCE(p_created_at, now()),
    COALESCE(p_currency, 'usd'), p_amount_krw
  )
  ON CONFLICT (provider, provider_invoice_id) DO UPDATE
    SET status           = COALESCE(EXCLUDED.status, bi.status),
        amount_usd_cents = COALESCE(EXCLUDED.amount_usd_cents, bi.amount_usd_cents),
        amount_krw       = COALESCE(EXCLUDED.amount_krw, bi.amount_krw),
        currency         = COALESCE(EXCLUDED.currency, bi.currency),
        billing_reason   = COALESCE(EXCLUDED.billing_reason, bi.billing_reason),
        invoice_url      = COALESCE(EXCLUDED.invoice_url, bi.invoice_url);

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_subscription_invoice(text,text,text,integer,text,text,text,timestamptz,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_subscription_invoice(text,text,text,integer,text,text,text,timestamptz,text,integer)
  TO service_role;

-- get_my_payment_history — add currency + amount_krw; orders render in their charged
-- currency (provider='toss' → KRW, else USD). DROP+CREATE (return columns changed).
DROP FUNCTION IF EXISTS public.get_my_payment_history(int, timestamptz);
CREATE OR REPLACE FUNCTION public.get_my_payment_history(
  p_limit  int         DEFAULT 20,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  ref              text,
  source           text,
  product_id       text,
  title            text,
  kind             text,
  amount_usd_cents integer,
  amount_krw       integer,
  currency         text,
  billing_reason   text,
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
           pi.amount_krw                      AS amount_krw,
           CASE WHEN pi.provider = 'toss' THEN 'krw' ELSE 'usd' END AS currency,
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
           bi.amount_krw,
           COALESCE(bi.currency, 'usd')       AS currency,
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

-- ── 4) Toss renewal scheduler helpers (service_role only) ─────────────────────
-- Toss does NOT auto-charge subscriptions — the toss-renew edge fn (daily cron) runs
-- the recurring charge itself. This returns the subs DUE for renewal with the secret
-- billingKey needed to charge them (service-role only — billingKey never leaves here).
-- DUE = provider='toss', still entitled (active/past_due), not set to cancel, period
-- ended (<= now), and a billingKey on file.
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
  user_email               text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT s.id, s.user_id, s.provider_subscription_id, s.product_id, s.current_period_end,
         c.billing_key, c.customer_key, bp.price_krw, bp.title, u.email
    FROM billing_subscriptions s
    JOIN toss_customers   c  ON c.user_id = s.user_id
    JOIN billing_products bp ON bp.id = s.product_id
    LEFT JOIN auth.users  u  ON u.id = s.user_id
   WHERE s.provider = 'toss'
     AND s.status IN ('active','past_due')
     AND s.cancel_at_period_end = false
     AND s.current_period_end IS NOT NULL
     AND s.current_period_end <= now()
     AND c.billing_key IS NOT NULL
   ORDER BY s.current_period_end ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE EXECUTE ON FUNCTION public.get_due_toss_renewals(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_due_toss_renewals(int) TO service_role;

-- Expire TOSS subs whose paid period has ended and that won't renew (set to cancel, or
-- a stale past_due whose period ended > 3 days ago). _owned_card_limit already stops
-- granting once the period passes; this just makes the STATUS reflect reality. Returns
-- the number expired. service_role only.
CREATE OR REPLACE FUNCTION public.expire_ended_toss_subscriptions()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE billing_subscriptions
       SET status = 'expired', updated_at = now()
     WHERE provider = 'toss'
       AND status IN ('active','canceled','past_due')
       AND current_period_end IS NOT NULL
       AND (
            (cancel_at_period_end = true AND current_period_end <= now())
         OR (status = 'past_due' AND current_period_end <= now() - interval '3 days')
       )
     RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::integer FROM upd;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_ended_toss_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_ended_toss_subscriptions() TO service_role;
