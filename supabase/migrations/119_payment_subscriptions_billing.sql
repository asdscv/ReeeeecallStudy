-- ============================================================================
-- 119: Payment / billing_subscriptions billing (DRAFT backend).
--
-- Builds the server half of paid plans on top of the existing money rails:
--   * billing_products — the seeded, read-only PRODUCT CATALOG (credit packs +
--     subscription plans). SELECT to authenticated (active only); writes are
--     service_role/admin (no client write policy, no client GRANT).
--   * billing_subscriptions    — per-user subscription state. A user reads their OWN rows;
--     all writes go through SECURITY DEFINER RPCs (service_role/admin only).
--   * PER-USER card limit — _owned_card_limit(uuid) now returns the subscriber's
--     plan card_limit when they hold an active (unexpired) subscription, else the
--     global card_limit_settings cap. This is how a Pro plan RAISES the 1000 cap to
--     10000 — replacing mig 116's commented "PHASE 2 SEAM" with real data.
--   * grant_subscription / admin_grant_subscription — activate a plan (webhook or
--     admin), idempotent on (provider, provider_ref), 1 active sub per user.
--
-- Additive/idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE only. The
-- no-arg _owned_card_limit() from mig 116 is kept untouched for back-compat.
-- ============================================================================

-- ── 1) billing_products — seeded read-only catalog ──────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_products (
  id                text    PRIMARY KEY,
  kind              text    NOT NULL CHECK (kind IN ('credit_pack','subscription')),
  title             text    NOT NULL,
  price_krw         integer NOT NULL,
  credits_micro_won bigint,                 -- credit_pack only (micro-WON minted)
  tier              text,                    -- subscription only
  card_limit        integer,                 -- subscription only (raises owned-card cap)
  period            text,                    -- e.g. 'monthly' (subscription only)
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true
);
ALTER TABLE public.billing_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_products readable" ON public.billing_products;
CREATE POLICY "billing_products readable"
  ON public.billing_products FOR SELECT TO authenticated
  USING (is_active);
-- no INSERT/UPDATE/DELETE policy → writes only via service_role / SECURITY DEFINER.

REVOKE ALL   ON public.billing_products FROM anon, authenticated;
GRANT  SELECT ON public.billing_products TO authenticated;
GRANT  ALL   ON public.billing_products TO service_role;

-- Seed the catalog. credits_micro_won = price_krw * 1_000_000 for credit packs.
INSERT INTO public.billing_products
  (id, kind, title, price_krw, credits_micro_won, tier, card_limit, period, sort_order, is_active)
VALUES
  ('credits_1000',  'credit_pack',  '₩1,000',        1000,   1000000000,  NULL,  NULL,   NULL,      1, true),
  ('credits_5000',  'credit_pack',  '₩5,000',        5000,   5000000000,  NULL,  NULL,   NULL,      2, true),
  ('credits_10000', 'credit_pack',  '₩10,000',      10000,  10000000000,  NULL,  NULL,   NULL,      3, true),
  ('sub_pro_monthly','subscription','Pro (monthly)', 4900,   NULL,        'pro', 10000,  'monthly', 10, true)
ON CONFLICT (id) DO NOTHING;

-- ── 2) billing_subscriptions — per-user plan state ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id         text        REFERENCES public.billing_products(id),
  tier               text        NOT NULL,
  status             text        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','canceled','expired','grace')),
  card_limit         integer,
  provider           text,
  provider_ref       text,
  current_period_end timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;

-- At most ONE active subscription per user.
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_active_per_user
  ON public.billing_subscriptions (user_id) WHERE status = 'active';
-- Webhook idempotency: a (provider, provider_ref) pair maps to one row (NULLs OK).
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_ref_uk
  ON public.billing_subscriptions (provider, provider_ref);

DROP POLICY IF EXISTS "billing_subscriptions select own" ON public.billing_subscriptions;
CREATE POLICY "billing_subscriptions select own"
  ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- no client INSERT/UPDATE/DELETE policy → writes only via service_role / definer RPCs.

REVOKE ALL   ON public.billing_subscriptions FROM anon, authenticated;
GRANT  SELECT ON public.billing_subscriptions TO authenticated;
GRANT  ALL   ON public.billing_subscriptions TO service_role;

-- ── 3) PER-USER owned-card limit ────────────────────────────────────────────
-- An active, unexpired subscription with a card_limit RAISES the cap to that value;
-- otherwise fall back to the global card_limit_settings cap. Picks the highest plan
-- limit if (somehow) multiple apply. Keeps the no-arg mig-116 version for back-compat.
CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.card_limit FROM billing_subscriptions s
       WHERE s.user_id = p_owner AND s.status = 'active'
         AND (s.current_period_end IS NULL OR s.current_period_end > now())
         AND s.card_limit IS NOT NULL
       ORDER BY s.card_limit DESC LIMIT 1),
    (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1));
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit(uuid) FROM PUBLIC, anon, authenticated;

-- check_card_limit — mig 116 body, VERBATIM, except v_limit now uses the per-user fn.
CREATE OR REPLACE FUNCTION public.check_card_limit(p_owner uuid, p_adding integer)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owned integer;
  v_limit integer;
BEGIN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_adding IS NULL OR p_adding <= 0 THEN RETURN; END IF;

  -- Admins are never capped (mirrors the session-limit admin bypass). Keyed on the
  -- card OWNER so it holds for service_role-invoked paths too.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_owner AND role = 'admin') THEN RETURN; END IF;

  -- ── PHASE 2 SEAM — subscription unlock. Uncomment when payment/billing_subscriptions live: ──
  -- IF EXISTS (SELECT 1 FROM billing_subscriptions
  --            WHERE user_id = p_owner AND tier <> 'free'
  --              AND status IN ('active','trialing')) THEN RETURN; END IF;

  v_limit := public._owned_card_limit(p_owner);
  -- serialize per-user so two concurrent creates into DIFFERENT decks can't both
  -- read (limit-1) and both pass. Cheap; released at txn end.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
  v_owned := public._owned_card_count(p_owner);
  IF v_owned + p_adding > v_limit THEN
    RAISE EXCEPTION 'card_limit_reached'
      USING errcode = 'PT402',
            hint    = 'CARD_LIMIT_REACHED',
            detail  = format('owned=%s adding=%s limit=%s', v_owned, p_adding, v_limit);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_card_limit(uuid, integer) FROM PUBLIC, anon, authenticated;

-- get_owned_card_usage — mig 116 body, VERBATIM, except the limit is per-user.
CREATE OR REPLACE FUNCTION public.get_owned_card_usage()
  RETURNS TABLE(owned integer, card_limit integer, available integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public._owned_card_count(auth.uid()),
         public._owned_card_limit(auth.uid()),
         greatest(public._owned_card_limit(auth.uid()) - public._owned_card_count(auth.uid()), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.get_owned_card_usage() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_owned_card_usage() TO authenticated;

-- ── 4) RPCs ─────────────────────────────────────────────────────────────────

-- get_my_subscription() — caller's active sub as JSON (or NULL), auth.uid()-scoped.
CREATE OR REPLACE FUNCTION public.get_my_subscription()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT row_to_json(s)
  FROM (
    SELECT id, user_id, product_id, tier, status, card_limit,
           provider, provider_ref, current_period_end, created_at, updated_at
    FROM billing_subscriptions
    WHERE user_id = auth.uid() AND status = 'active'
    ORDER BY current_period_end DESC NULLS LAST
    LIMIT 1
  ) s;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_subscription() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;

-- get_billing_products() — active catalog as a JSON array, ordered by sort_order.
CREATE OR REPLACE FUNCTION public.get_billing_products()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
  FROM (
    SELECT id, kind, title, price_krw, credits_micro_won, tier, card_limit, period, sort_order, is_active
    FROM billing_products
    WHERE is_active
    ORDER BY sort_order, id
  ) p;
$$;
REVOKE EXECUTE ON FUNCTION public.get_billing_products() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_billing_products() TO authenticated;

-- grant_subscription() — activate/refresh a plan. service_role (webhook) / admin only.
-- Reads tier + card_limit from the catalog; deactivates any prior active sub for the
-- user, then inserts a fresh active row. Idempotent on (provider, provider_ref).
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

  -- Serialize per-user so concurrent grants can't both insert an active row.
  -- The lock is taken BEFORE the idempotency check so a SIMULTANEOUS redelivery of the
  -- same (provider, provider_ref) can't slip past the EXISTS check and then cancel the
  -- row the winning delivery just inserted (leaving the user with no active sub).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 77));

  -- Idempotent: a redelivery with the same (provider, provider_ref) is a no-op.
  -- Re-checked here, inside the lock, so serialized redeliveries see the committed row.
  IF p_provider IS NOT NULL AND p_provider_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM billing_subscriptions
    WHERE provider = p_provider AND provider_ref = p_provider_ref
  ) THEN
    RETURN;
  END IF;

  -- One active sub per user (partial unique index): retire the prior active first.
  UPDATE billing_subscriptions
     SET status = 'canceled', updated_at = now()
   WHERE user_id = p_user AND status = 'active';

  INSERT INTO billing_subscriptions (
    user_id, product_id, tier, status, card_limit,
    provider, provider_ref, current_period_end, created_at, updated_at
  ) VALUES (
    p_user, p_product_id, COALESCE(v_tier, 'pro'), 'active', v_card_limit,
    p_provider, p_provider_ref, p_period_end, now(), now()
  )
  ON CONFLICT (provider, provider_ref) DO NOTHING;  -- concurrency backstop for idempotency
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_subscription(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_subscription(uuid, text, text, text, timestamptz) TO service_role;

-- admin_grant_subscription() — manual/comp grant. is_admin() only; provider='admin'.
CREATE OR REPLACE FUNCTION public.admin_grant_subscription(
    p_user       uuid,
    p_product_id text,
    p_period_end timestamptz DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  PERFORM public.grant_subscription(
    p_user, p_product_id, 'admin', 'admin:' || gen_random_uuid()::text, p_period_end);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_grant_subscription(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_subscription(uuid, text, timestamptz) TO authenticated;
