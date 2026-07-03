# Payment — Owner Setup (the ONLY steps left)

All code + infra is built, verified, and (once this lands) deployed to prod **gated OFF /
fail-closed** — nothing charges until you do the steps below. Web = **LemonSqueezy**
(Merchant of Record, handles global tax). Mobile = **Apple/Google IAP via RevenueCat**
(mandatory for digital goods). Both grant into the same wallet/subscription backend.

Catalog (already seeded in `billing_products`): `credits_1000` (₩1,000), `credits_5000`
(₩5,000), `credits_10000` (₩10,000), `sub_pro_monthly` (₩4,900 → card limit 1000→10000).

---

## 1) Web — LemonSqueezy

1. Create a LemonSqueezy account + **Store**. Complete payout/tax onboarding (LS is the
   merchant of record — it collects & remits VAT/sales tax for you).
2. Create **Products** (currency = **USD** for a global store), one product per catalog row:
   - one-time (Single payment): $0.99 / $4.99 / $9.99 → credits_1000/5000/10000
   - subscription (monthly): $1.99 → sub_5k_monthly, $9.99 → sub_unlimited_monthly
   Prices need NOT numerically equal the catalog (grants key off the variant→product
   map, never the amount). For each variant note **BOTH** identifiers — they are DIFFERENT
   and used in DIFFERENT places:
   - the **numeric variant id** (LS API `id`, e.g. `1864772`) — used by the WEBHOOK.
   - the **variant `slug`** (a UUID, e.g. `a98e3678-…`) — used by the CHECKOUT URL.
   Get both from LS API `GET /v1/variants/<id>` → `data.attributes.slug`, or read the
   slug off the product's **Share → checkout link** (`…/checkout/buy/<SLUG>`).
   > ⚠️ **The checkout URL needs the SLUG (UUID), NOT the numeric id.** `…/checkout/buy/1864772`
   > returns **404**; `…/checkout/buy/<slug-uuid>` works. Putting numeric ids in
   > VITE_LEMONSQUEEZY_VARIANTS makes every checkout 404.
   > ⚠️ **Test vs live are SEPARATE.** Products created before store activation are
   > `test_mode=true` with their own ids+slugs. When you go LIVE, the live products get
   > DIFFERENT numeric ids AND slugs → you must re-capture both and update BOTH env values.
3. Set the Vite BUILD env (Cloudflare → Worker → **Settings → Build → Build variables**,
   NOT the runtime "Variables and secrets"; VITE_ is inlined at `vite build`):
   ```
   VITE_PAYMENT_PROVIDER=lemonsqueezy
   VITE_PAYMENTS_ENABLED=true
   VITE_LEMONSQUEEZY_STORE=<store-subdomain>               # e.g. sapiotrix → sapiotrix.lemonsqueezy.com
   # value = product_id → variant SLUG (UUID), the /checkout/buy/<SLUG> path — NOT numeric id
   VITE_LEMONSQUEEZY_VARIANTS={"credits_1000":"<slug>","credits_5000":"<slug>","credits_10000":"<slug>","sub_5k_monthly":"<slug>","sub_unlimited_monthly":"<slug>"}
   ```
4. LemonSqueezy → Settings → **Webhooks** → add:
   - URL: `https://<project-ref>.functions.supabase.co/lemonsqueezy-webhook`
   - Events: `order_created`, `subscription_created`, `subscription_updated`,
     `subscription_cancelled`, `subscription_resumed`, `subscription_expired`,
     `subscription_paused`, `subscription_payment_failed`, `subscription_payment_success`,
     `subscription_payment_refunded`, `order_refunded` (checking ALL events is fine too)
   - Copy the **signing secret** → set BOTH Supabase edge secrets:
     ```
     supabase secrets set LEMONSQUEEZY_WEBHOOK_SECRET=<secret>
     # value = NUMERIC variant_id → product_id (inverse of VITE_LEMONSQUEEZY_VARIANTS keys);
     # the webhook receives the NUMERIC variant_id in the payload, so this map is numeric.
     supabase secrets set LEMONSQUEEZY_VARIANT_MAP='{"1864772":"credits_1000",...}'
     ```
5. Each subscription/product → set the post-purchase **Redirect URL** to
   `https://<app>/settings?pay=success` (so the app refreshes the wallet on return).

---

## 2) Mobile — Apple/Google IAP via RevenueCat

> Digital goods MUST use the stores' in-app purchase. The paywall UI stays HIDDEN until
> IAP products exist (this is what caused the earlier Apple 2.1(b) rejection).

1. **App Store Connect**: create In-App Purchase products (auto-renewable subscription for
   Pro, consumables for credit packs). **Play Console**: create the equivalent
   subscription + in-app products. Submit them.
2. **RevenueCat**: create a project, add the App Store + Play apps, and add the store
   products as RevenueCat products/entitlements. Note each RevenueCat product id.
3. RevenueCat → Integrations → **Webhooks**:
   - URL: `https://<project-ref>.functions.supabase.co/revenuecat-webhook`
   - Authorization header value: a random secret → set both sides:
     `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<same-value>`
   - Product map (store product id → our catalog id):
     `supabase secrets set REVENUECAT_PRODUCT_MAP='{"<rc_pro_monthly>":"sub_pro_monthly","<rc_credits_5000>":"credits_5000"}'`
4. In the app, set the RevenueCat public SDK key + un-hide the paywall gate (the code
   already calls `Purchases.logIn(<our user id>)` so the webhook can map the buyer).
5. `eas build` a new mobile build (payment/paywall are native → OTA won't ship them) and
   submit to both stores.

---

## 3) Already done for you (no action needed)

- ✅ Migrations `119` / `120` / `121` applied to prod (billing_products, billing_subscriptions,
  payment_intents, per-user card limit, full lifecycle RPCs). Card limit is unchanged for
  everyone until a subscription exists.
- ✅ Edge functions deployed (fail-closed): `payment-webhook`, `lemonsqueezy-webhook`,
  `revenuecat-webhook` — they return 503 until their secret is set.
- ✅ Web + mobile UI wired behind the gate; "canceling on <date>" note; wallet/limit
  auto-refresh on purchase.

## 4) Flip on + smoke test

- Web: set the env vars above → redeploy → the top-up/subscribe buttons go live.
- Buy a credit pack in LS test mode → wallet balance rises by the pack amount.
- Buy the sub → card limit jumps to 10,000; cancel → shows "canceling on <date>", access
  holds until period end; let it expire → limit reverts to 1,000.
- Mobile: sandbox-purchase in TestFlight / internal testing → same grants.

## Lifecycle (already handled by the webhooks → RPCs)

cancel → keep access to period end (`cancel_at_period_end`) · expire → limit reverts ·
renew → extend · payment failed → `past_due` grace keeps access · refund/chargeback →
revoke immediately · the `current_period_end` check is a safety net so a stale row can
never grant forever. Verified on a fresh stack (11/11).

## Known follow-ups (not blockers)

- Edge-hardening from the review pass (retire sibling subs on resume; guard the catalog
  lookup) — unreachable under the normal 1-subscription-per-user flow.
- Recurring billing key for PortOne (unused; LemonSqueezy handles recurring natively).
