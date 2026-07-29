# Mobile IAP (RevenueCat) — Integration status & owner go-live checklist

_Last updated: 2026-07-21 (branch `feat/mobile-iap-integration`)_

## What is DONE (code — verified on a real iOS build)

The mobile in-app-purchase integration is **code-complete and verified on device**:

- `react-native-purchases@^10.4.4` (New-Architecture ready) installed in `packages/mobile`.
  The previous removal was a **pre-New-Arch** version that crashed under RN 0.83; v10
  builds & runs clean (verified: clean `expo prebuild -p ios --clean` + `run:ios`,
  app launched with **no crash**, 2015 JS modules bundled).
- `src/services/purchases.ts` — RevenueCat service (configure / logIn / getOfferings /
  purchase / restore / entitlement / `merchant_uid` attribute). Real SDK types restored
  (`import type`), defensive runtime `require` kept so a native-link failure degrades to
  no-ops instead of crashing.
- `src/hooks/usePurchases.ts` + `PaywallScreen` + `PlanSelector` + `SettingsScreen`
  entry points are wired and render behind the `SUBSCRIPTION_UI_ENABLED` gate.
- Server side already exists: `supabase/functions/revenuecat-webhook` (grants credits /
  activates subscriptions from RC events, keyed on `app_user_id == supabase uid`).

**Verified on a native iOS build (2026-07-21), gate temporarily flipped to true:**
- SDK `configure` succeeded with `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
- `Purchases.logIn(<supabase uid>)` set `app_user_id` = our uid — RC made a live call
  `GET /v1/subscribers/<uid>/offerings` → **200**.
- Paywall rendered (feature comparison + `5,000 cards $3.99` / `Unlimited $19.99`).
- Only "error": `no App Store products registered in the RevenueCat dashboard` — the
  expected owner step below.

The gate is committed as `SUBSCRIPTION_UI_ENABLED = false` (Apple Guideline 2.1(b) — no
live paywall without approved IAP products). Flipping it to `true` is the final switch.

> **This branch is NOT for merge to `main` as-is.** The feature was previously pulled for
> an App Store review rejection; re-enabling requires the store setup below **and** a
> deliberate decision to re-submit. A native store build + review is required (NOT OTA).

## What only the OWNER can do (external, blocks real purchases)

1. **App Store Connect** — create the IAP products: an auto-renewing subscription group
   with the two tiers, plus consumable credit-pack products. Set them to "Ready to Submit".
2. **Google Play Console** — create the same products **and finish the merchant/payment
   profile** (this was the original Android blocker; identity + bank + tax). Add the
   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (missing today — only the iOS key is set).
3. **RevenueCat dashboard** — create an **Offering** whose package/product identifiers
   EQUAL our `billing_products.id` (`sub_5k_monthly`, `sub_unlimited_monthly`, credit
   packs), attach the subscriptions to the **`pro` entitlement**, and set the webhook to
   `<supabase>/functions/v1/revenuecat-webhook` with the shared bearer token.
4. **Supabase Edge secrets** — `REVENUECAT_WEBHOOK_AUTH` (bearer) and
   `REVENUECAT_PRODUCT_MAP` (JSON: store product id → our `billing_products.id`).
5. **Sandbox test** — a sandbox Apple ID (iOS) / license tester (Android) to run a real
   purchase and confirm the RC webhook grants the entitlement/credits server-side.
6. **Go-live** — flip `SUBSCRIPTION_UI_ENABLED = true`, native EAS build for iOS + Android,
   submit to the stores, and pass review (address the prior rejection reason).

## Product catalog (already in DB, active)

| kind | id | price |
|---|---|---|
| subscription | `sub_5k_monthly` | $3.99 / mo (5,000 cards) |
| subscription | `sub_unlimited_monthly` | $19.99 / mo (unlimited) |
| credit_pack | `credits_*` | $0.99 / $4.99 / $9.99 |

The server catalog (`get_billing_products`) is the source of truth; the RC offering must
mirror these ids so `findPackageForProduct` maps store packages to the backend catalog.
