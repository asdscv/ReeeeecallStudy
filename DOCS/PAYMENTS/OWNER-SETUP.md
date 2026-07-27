# Payment — Owner Setup (the ONLY steps left)

All code + infra is built, verified, and (once this lands) deployed to prod **gated OFF /
fail-closed** — nothing charges until you do the steps below. Web = **LemonSqueezy**
(Merchant of Record, handles global tax). Mobile = **Apple/Google IAP via RevenueCat**
(mandatory for digital goods). Both grant into the same wallet/subscription backend.

Catalog (already seeded in `billing_products`, all USD): `credits_1000` ($0.99), `credits_5000`
($4.99), `credits_10000` ($9.99) — one-time AI-credit packs, granted at **face value 1:1**
(mig 145: $0.99 tops up $0.99); `sub_5k_monthly` ("Standard", $3.99/mo → 5,000 cards),
`sub_unlimited_monthly` ("Pro", $19.99/mo → 100,000 cards). These internal ids are **stable
and never change** — the store SKUs (below) map TO them.

---

## 0) Store-SKU catalog — the single source of truth (mig 151)

The mapping between a **store product id** (what App Store / Play / LemonSqueezy call the
product) and our **internal `billing_products.id`** lives in ONE table,
`billing_product_skus`, keyed `(platform, store_product_id) → product_id`. Registering or
rotating a store product is now a single call — **no secret edit, no redeploy, no app
rebuild**:

```sql
-- Register / rotate a store SKU (admin or service_role). Re-pointing an internal product at
-- a NEW store id auto-retires the previous active one (its unique-active index).
select set_store_product_sku('ios',         'ai_credit_099', 'credits_1000');
select set_store_product_sku('android',     'ai_credit_099', 'credits_1000');
select set_store_product_sku('lemonsqueezy','<live variant id>', 'credits_1000');
-- deactivate a retired SKU explicitly if needed:
select set_store_product_sku('ios','<old id>','credits_1000', false);
```

- **iOS/Android credit + subscription SKUs are pre-seeded** by mig 151 (`ai_credit_099/499/999`
  for the packs; `sub_5k_monthly_v2` / `sub_unlimited_monthly_v3` for the plans). You only
  call `set_store_product_sku` if you change a store id later.
- **LemonSqueezy is NOT pre-seeded** (its live variant ids differ from test mode and are
  known only to you) → register them with `set_store_product_sku('lemonsqueezy', …)` at
  go-live.
- The webhooks read this table **DB-first** and fall back to the legacy env maps
  (`REVENUECAT_PRODUCT_MAP`, `LEMONSQUEEZY_VARIANT_MAP`) only when a SKU isn't registered —
  so the env vars below are now **optional/legacy**; the DB catalog is authoritative.

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
   # PRIMARY provider var is the PLURAL comma-list (order = default/primary first). To offer
   # BOTH web providers as a checkout CHOICE use e.g. `toss,lemonsqueezy`. The singular
   # VITE_PAYMENT_PROVIDER is only a legacy one-element fallback (used when the plural is unset).
   VITE_PAYMENT_PROVIDERS=lemonsqueezy          # or e.g. toss,lemonsqueezy for a choice
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

## 1b) Web — TossPayments (토스페이먼츠) — optional second web provider

Toss is a Korean PG (charges in **KRW**, not a Merchant of Record — you handle tax). It is a
fully-wired SECOND web checkout provider; a buyer picks Toss or LemonSqueezy at checkout when
both are enabled. Going live with Toss needs a **TossPayments merchant contract** (사업자 등록 +
가맹 심사) to obtain LIVE keys — until then the `test_ck_`/`test_sk_` test keys drive the flow in
test mode only (no real charge).

1. Sign up at TossPayments, complete the merchant onboarding, and get the **client key** and
   **secret key** (test → `test_ck_…`/`test_sk_…`; live → `live_ck_…`/`live_sk_…`).
2. Set the Cloudflare **BUILD** vars (same place as the LS ones above):
   ```
   VITE_PAYMENT_PROVIDERS=toss,lemonsqueezy      # add 'toss' (order = default first)
   VITE_TOSS_CLIENT_KEY=<test_ck_… → live_ck_…>  # baked into the bundle; go-live = swap to live_ck_
   ```
3. Set the Supabase edge **secrets**:
   ```
   supabase secrets set TOSS_SECRET_KEY=<test_sk_… → live_sk_…>   # server confirm/billing charge
   supabase secrets set TOSS_RENEW_SECRET=<any strong string>     # auth for the daily renew cron
   supabase secrets set TOSS_ENABLED=true                         # (already set)
   ```
4. Edge fns (already deployed): `toss-confirm` (one-time credit-pack confirm), `toss-billing`
   (subscription billing-key auth + first charge), `toss-renew` (daily cron charges due Toss subs
   — Toss has no hosted auto-renew, WE run it), `toss-webhook`. The renew cron is the GitHub
   workflow `.github/workflows/toss-renew.yml` (needs the `TOSS_RENEW_SECRET` + functions URL as
   repo secrets) — confirm it is scheduled/enabled once live.
5. GO-LIVE swap: replace `VITE_TOSS_CLIENT_KEY` (build var) `test_ck_`→`live_ck_` AND
   `TOSS_SECRET_KEY` (secret) `test_sk_`→`live_sk_`, then redeploy the web (VITE keys bake at build).

---

## 2) Mobile — Apple/Google IAP via RevenueCat

> Digital goods MUST use the stores' in-app purchase. The paywall UI stays HIDDEN until
> IAP products exist (this is what caused the earlier Apple 2.1(b) rejection).

1. **App Store Connect** — create the In-App Purchase products with the **exact store ids**
   mig 151 seeded (so no `set_store_product_sku` call is needed):
   - **Consumable** credit packs (⚠️ MUST be Consumable — re-purchasable; a Non-Consumable
     can only be bought once and never re-charged):
     - `ai_credit_099` — display name **"AI Credit $0.99"** — price tier **Tier 1 ($0.99)**
     - `ai_credit_499` — display name **"AI Credit $4.99"** — price tier **$4.99**
     - `ai_credit_999` — display name **"AI Credit $9.99"** — price tier **$9.99**
   - **Auto-renewable subscriptions**: `sub_5k_monthly_v2` ("Standard", $3.99/mo),
     `sub_unlimited_monthly_v3` ("Pro", $19.99/mo) — one subscription group, Pro the higher
     tier. (These already exist from the earlier setup.)
   > The app shows the user's LOCAL currency automatically — you pick the **price tier**
   > (e.g. the "$0.99" tier), the stores localize it (₩/¥/€…). We grant the **USD face value**
   > ($0.99) regardless of what the buyer's local tier charges.
   > ⚠️ If a wrongly-typed (Non-Consumable) `credits_*`/`ai_credit_*` already exists, you can't
   > change its type or reuse its id — create the Consumable under the id above and leave/delete
   > the bad one (Apple permanently reserves used ids, hence the fresh `ai_credit_*` names).
2. **Play Console**: create the **same ids** as managed **consumable** in-app products +
   the two subscriptions. Google does not reserve types, but keep ids identical to iOS.
3. **RevenueCat**: create a project, add the App Store + Play apps, add the store products,
   and put them in an **Offering** whose packages expose those store products. Attach the two
   subscriptions to the **`pro`** entitlement; credit packs get NO entitlement (consumables —
   the webhook tops up the wallet). The app matches packages by the **store product id**
   (`BillingProduct.storeProductId` from `get_billing_products(platform)`), so you do NOT need
   to hand-set package identifiers to our internal ids anymore.
4. RevenueCat → Integrations → **Webhooks**:
   - URL: `https://<project-ref>.functions.supabase.co/revenuecat-webhook`
   - Authorization header value: a random secret → set both sides:
     `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<same-value>`
   - **Product map is now optional** — the webhook resolves store id → our id from the mig-151
     SKU catalog first. `REVENUECAT_PRODUCT_MAP` is only a legacy fallback for store ids not in
     the catalog; leave it unset if you used the seeded ids.
5. In the app, set the RevenueCat public SDK key + un-hide the paywall gate
   (`SUBSCRIPTION_UI_ENABLED`); the code already calls `Purchases.logIn(<our user id>)` so the
   webhook can map the buyer.
6. `eas build` a new mobile build (payment/paywall are native → OTA won't ship them) and
   submit to both stores.

### Web credit packs — no recreation needed
LemonSqueezy one-time products have no consumable/non-consumable distinction, so the existing
web credit products keep working. Only (a) optionally rename their display to "AI Credit $0.99"
for consistency, and (b) register their live variant ids in the SKU catalog:
`select set_store_product_sku('lemonsqueezy','<variant id>','credits_1000');` (etc.).

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
