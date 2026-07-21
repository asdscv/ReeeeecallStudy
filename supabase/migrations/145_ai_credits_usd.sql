-- ============================================================================
-- 145: Convert the AI-credit metering from micro-WON to micro-USD.
--
-- The AI provider (Gemini) bills natively in USD, and the store now charges USD
-- everywhere (LemonSqueezy; Toss/₩ dropped). Denominating the wallet in USD too
-- REMOVES the FX layer entirely: charge_ai_generation converts the token cost to
-- USD and, with usd_won_rate = 1, that USD value IS the deducted amount (no ₩ hop).
--
-- The internal columns keep their historical `*_won*` / `micro_won` names (renaming
-- would churn every RPC + client); their UNIT is now micro-USD (1e-6 USD). The
-- client formats them as `$`. All existing test-phase data (payments gated → only
-- owner comp balances) is converted ÷ the old 1350 rate so nothing is orphaned and
-- the est-price refresh (which averages historical ai_cost_ledger.price_won_micros)
-- stays on the same USD scale as new charges.
--
-- One-time DATA migration (not idempotent-on-rerun, but migrations run once). On a
-- fresh CI DB the UPDATEs touch the seed row(s) only; the ÷1350 also rebases the
-- seeded est-price + settings to USD, so fresh and prod converge.
-- ============================================================================

-- Old rate for the one-time rebase of existing ₩-denominated values.
DO $$
DECLARE r numeric := 1350;
BEGIN
  -- 1) Identity FX going forward + rebase the seed est-price (₩2/card → ~$0.0015).
  UPDATE public.ai_pricing_settings
     SET usd_won_rate = 1,
         est_price_per_card_micro = GREATEST(1, round(est_price_per_card_micro / r))
   WHERE id = 1;

  -- 2) Prepaid wallet balances + the user-facing ledger → micro-USD.
  UPDATE public.ai_credit_balance SET balance = round(balance / r);
  UPDATE public.ai_credit_ledger
     SET delta = round(delta / r), balance_after = round(balance_after / r);

  -- 3) Cost-accounting history → micro-USD so margin reports + refresh_ai_est_price
  --    stay on one scale (cost_usd_micros is already USD; leave it).
  UPDATE public.ai_cost_ledger
     SET cost_won_micros   = round(cost_won_micros   / r),
         price_won_micros  = round(price_won_micros  / r),
         margin_won_micros = round(margin_won_micros / r);
  UPDATE public.ai_generation_jobs
     SET price_micro_won = round(price_micro_won / r)
   WHERE price_micro_won IS NOT NULL;

  -- 4) Any still-pending payment intents (stale, gated) — rebase the grant amount.
  UPDATE public.payment_intents
     SET amount_micro_won = round(amount_micro_won / r)
   WHERE amount_micro_won IS NOT NULL AND status = 'pending';
END $$;

-- 5) Credit packs grant their USD price 1:1 (micro-USD). $0.99 → 990,000 micro-USD.
--    (Was a ₩ amount = price_krw * 1e6.) Uses price_usd_cents so it self-aligns to
--    whatever USD price the catalog carries.
UPDATE public.billing_products
   SET credits_micro_won = price_usd_cents::bigint * 10000
 WHERE kind = 'credit_pack' AND price_usd_cents IS NOT NULL;

-- 6) Admin billing KPIs now sum USD, not ₩. MRR from price_usd_cents; 30d revenue
--    prefers the snapshotted amount_micro_won (now micro-USD) and falls back to the
--    product's USD price for subscription rows that carry no micro amount. (Gated /
--    owner-only surface, but keep the formula correct for launch.)
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
      (SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'active'),
    'canceling',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE cancel_at_period_end = true),
    'past_due',
      (SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'past_due'),
    -- MRR: sum the catalog USD price (micro-USD) of every ACTIVE sub's product.
    'mrr_micro_won',
      COALESCE((
        SELECT SUM(p.price_usd_cents::bigint * 10000)
        FROM billing_subscriptions s
        JOIN billing_products p ON p.id = s.product_id
        WHERE s.status = 'active'
      ), 0),
    'wallet_total_micro',
      COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    -- Paid revenue in the last 30 days (micro-USD). Prefer the snapshotted
    -- amount_micro_won (micro-USD since mig 145); for subscription rows (no micro)
    -- fall back to the product's USD price.
    'paid_revenue_30d_micro',
      COALESCE((
        SELECT SUM(COALESCE(pi.amount_micro_won, bp.price_usd_cents::bigint * 10000, 0))
        FROM payment_intents pi
        LEFT JOIN billing_products bp ON bp.id = pi.product_id
        WHERE pi.status = 'paid' AND pi.paid_at > now() - interval '30 days'
      ), 0),
    'refunds_30d',
      (SELECT COUNT(*) FROM billing_subscriptions
        WHERE status = 'refunded' AND updated_at > now() - interval '30 days')
  ) INTO result;

  RETURN result;
END;
$function$;
