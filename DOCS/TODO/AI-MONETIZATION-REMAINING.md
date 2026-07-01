# AI Monetization — Remaining Work

Builds on the completed engineering: [2026-07-01-ai-server-generation.md](../DONE/2026-07-01-ai-server-generation.md)
(Phase 0/1a/1b + image UI + tests/CI/e2e + the refund money-bug fix — all SHIPPED to `develop`, NOT prod).

Everything below is what's **left**. None of it blocks the shipped engineering; it's the
business/economic layer + external rails + ops + minor cleanup.

---

## 1. Cost / margin / pricing layer  ✅ Phase 0 + METERED BILLING SHIPPED to develop / ⏳ payment pending

> **⚡ Charging model is now METERED (mig 114)** — fixed credits (1/card, 5/image) were **replaced** by a
> **micro-WON wallet + post-generation actual-cost deduction**: FREE 10 cards/day, then PAID = real token
> cost × markup (80% margin → ×5), deducted after the gen; failure = no charge (net-zero); pre-gen gate 402
> on empty wallet. `reserve_ai_generation` / `charge_ai_generation` / `release_ai_job` replace
> record/finalize/refund. Design of record: [AI-METERED-BILLING-DESIGN.md](./AI-METERED-BILLING-DESIGN.md).
> Live e2e 17/17 (Gemini): ₩0.39 charged for 2 cards. **Payment 1c just wires `add_ai_credits(₩pack × 1e6)`
> to top up the wallet.** The cost-capture / margin-monitoring layer (below) feeds this as the pricing engine.


**Phase 0 (cost capture + config seams) is BUILT + merged** — mig **112** (`ai_pricing_settings` /
`ai_pricing_config` / `ai_cost_ledger` + `finalize_ai_cost` / `set_ai_pricing_rate` /
`set_ai_pricing_settings` / `get_ai_margin_daily`) + the edge-fn token-usage threading + `finalizeCost()`;
DB-tested (`supabase/tests/ai_cost_margin_test.sql`, wired into the CI `ai-credit-tests` job) +
adversarially audited (MERGE-READY). Purely additive — the charging path is untouched.
**mig 113** set the **margin target to 80%** (`target_margin_bps=8000`) + added a **net-zero floor**
monitor (`get_ai_margin_daily.net_negative_jobs` = PAID rows priced below cost; free-tier CAC excluded)
+ **`preview_ai_cost(provider,model,tin,tout,credits)`** — a read-only **dry-run** of the cost math (no
ledger write) so the owner can preview margins before setting a rate/₩. Dry-run @ ₩100/credit shows the
default gemini-flash-lite at **~99% margin** (grok-3 / gemini-pro dip under 80% at 1 credit → flagged, still
net-positive; below-cost never breached). Live e2e (16/16) confirmed real-provider cost capture + net-zero-on-failure.

**⏳ Phase 1 (turn margin ON)** waits on the owner's business numbers (below) + verifying the seeded
INDICATIVE rates vs real provider invoices. Prod deploy ships with §3.

**Why (recap):** the wallet charged **flat credits** (`_ai_credits_per_card()=1`, `_ai_credits_per_image()=5`)
and **discarded** the provider's token usage — so real cost / margin / per-model pricing weren't modeled.
The owner's requirement: *deduct the right amount on real use, track spend + margin, all **extensible**
per provider/model without code edits.* Phase 0 delivers the observability + the config seams; the
numbers below flip it from observation to enforced pricing.

> **Design of record:** [AI-COST-MARGIN-DESIGN.md](./AI-COST-MARGIN-DESIGN.md) — full schema + migration sketch +
> edge-fn integration points (produced by the `ai-cost-margin-design` multi-agent workflow, grounded in live code).

**Backbone (recommended, decisive):** a **purely additive** economic layer that **never touches the live
charging path** (`record_ai_generation`/`record_ai_image`/`refund_ai_job` stay byte-for-byte) — zero risk to metering.

- **Cost capture** — the provider already returns OpenAI-compat `usage{prompt_tokens, completion_tokens}`; today
  it's **discarded** at `ai-generate/index.ts:163-166`. Thread it out of `providerRequest`/`generate` → a new
  `finalizeCost()` helper (mirrors `refundJob`, service-role, await-and-inspect-error) → **`finalize_ai_cost` RPC**
  writes one row to a new **`ai_cost_ledger`** keyed 1:1 on the existing `job_ref` (idempotent, post-generation).
- **Pricing = FIXED credits** (1/card, 5/image) — NOT dynamic. Rationale: IAP/PortOne sell **fixed-WON credit
  packs** (per-call variable pricing is unsellable + fails store review), and `getAffordableCards` quotes a
  deterministic cost **before** generating, and tokens are only known **after** the call. `_ai_won_per_credit()`
  (config, must mirror the IAP SKU) maps credit→₩; `price = job.credits × won_per_credit`.
- **Margin** — per-row `cost`/`price`/`margin_bps` + `rate_missing`/`estimated`/`under_target` flags; rollup view
  **`get_ai_margin_daily`** by (day, provider, model); alert rides the existing **Cloudflare daily-cron** (pg_cron
  not installed). Free-tier card cost shows as honest CAC (price 0 → segregated from margin stats).
- **Extensibility (no code/redeploy)** — per-`(provider, model)` rates live in **`ai_pricing_config`** (effective-dated);
  add a model = `set_ai_pricing_rate('gemini','gemini-2.5-pro', …)` (1 row); change margin/₩/FX =
  `set_ai_pricing_settings(…)` (1 RPC). Keys on the `(provider, model)` strings `resolveModel` already returns —
  **`ResolvedModel.provider` already exists**, so `ai-providers.ts` needs **zero change**.
- **Schema** — `mig 112`: `ai_pricing_settings` (1-row knobs) + `ai_pricing_config` (rates, effective-dated) +
  `ai_cost_ledger` (deny-all RLS) + `finalize_ai_cost`/`set_ai_pricing_*`/`get_ai_margin_daily` (SECURITY DEFINER,
  service_role/admin gated, `_ai_*` config-fn idiom). Micro-units (bigint) → no FP drift.

**Phased rollout:**
- **Phase 0 (build now — needs NO business numbers):** edge-fn usage threading + mig 112 (tables, config seams,
  `finalize_ai_cost`, monitoring RPC, seeded indicative rates). Pure observability — start collecting real per-model
  cost immediately; ignore margin until real cost is seen. Zero risk to the charging path.
- **Phase 1 (after owner sets numbers):** set real ₩/credit (= IAP SKU) + target margin; verify seeded rates vs
  first provider invoices; wire the admin dashboard card + Cloudflare-cron margin alert.
- **Phase 2 (only if data demands):** per-card refund deltas; auto re-price suggestions; revisit dynamic only if
  the vision path bleeds.

**⚠️ Open business decisions (OWNER must set — see design §9):** (1) **₩/credit** (must equal the IAP/PortOne
credit-pack price — also requires choosing the pack tiers/SKUs); (2) **target margin %** (default 70%, monitor-only);
(3) **fixed vs dynamic** (recommended fixed, built that way — ratify); (4) **free-tier CAC policy** (keep 10 free
cards/day uncapped? daily budget?) + FX update cadence.

---

## 2. Payment rails — Phase 1c  (server seam READY / provider integration = EXTERNAL)

- **Strategy A (store-compliant):** web = **PortOne** (카드/카카오/네이버/토스); mobile = **Apple IAP +
  Google Play Billing via RevenueCat**, consumable **₩ packs**. One micro-WON wallet unifies web+app.
- **Server seam is DONE + tested:** a verified payment top-up = **`add_ai_credits(p_user_id, p_micro_won,
  'purchase', p_ref)`** (service_role, **idempotent on `p_ref`** = the payment id → webhook retries can't
  double-credit; `p_micro_won` = **pack ₩ × 1_000_000**). Metered billing then deducts real cost from that
  balance. So 1c's only new server piece is the **verify→grant webhook**.
- **The webhook (per provider) — NOT built (security-sensitive, provider not chosen):** it mints wallet
  balance = money, so it MUST be **fail-closed**: reject unless the provider's verification is configured +
  passes. Contract per provider:
  - **PortOne (web):** on the client `onSuccess`, POST `{imp_uid, merchant_uid}` → server calls PortOne
    `GET /payments/{imp_uid}` (with the PortOne API secret) → confirm `status=paid` + amount matches the SKU →
    `add_ai_credits(uid, sku_won×1e6, 'purchase', imp_uid)`.
  - **RevenueCat (mobile IAP):** RevenueCat **webhook** (INITIAL_PURCHASE / NON_RENEWING_PURCHASE) with the
    `Authorization` shared-secret header → map product_id→₩ → `add_ai_credits(uid, won×1e6, 'purchase', event.id)`.
    (⚠️ RevenueCat currently DISABLED after a prior Apple reject — investigate the rejection cause first.)
- **External deps (not engineering):** PortOne merchant + API secret; App Store / Play product (SKU) setup +
  **Apple review**; the pack tiers/₩ prices (owner). Korea bans in-app out-links → mobile **must** use IAP
  (~15–30%, small-biz 15%); metered margin (~80%) absorbs the store cut.
- **When ready:** add a `payment-webhook` edge fn (fail-closed, service-role `add_ai_credits`), one per
  provider verification path above. The wallet, idempotency, and metered deduction are already in place.

## 3. Production deployment — GO-LIVE CHECKLIST  ⚠️ OWNER-GATED (outward-facing, real money)

**Everything is code-ready; this is the one high-stakes step an agent must NOT run unattended** — it
changes the prod DB schema (DROPs the old charging RPCs), deploys the edge fn, and promotes `develop`→`main`
which **auto-deploys the web app to real users**. Do it deliberately, ideally behind a launch flag. Until
done, prod generation returns a graceful `503 AI_NOT_CONFIGURED`.

**Order (do NOT reorder — set the key + apply migs BEFORE promoting to main):**
1. `supabase secrets set AI_GENERATION_PROVIDER_KEY=<gemini key>` (registry defaults to **gemini**, ~6× cheaper
   than Grok; the owner-provided Gemini key is in the gitignored `.env.local` — never in the repo).
   Verified usage-measurement works for BOTH providers (text + vision) so `ai_cost_ledger` prices either.
2. **Apply migrations 108–115 to prod** ⚠️ **mig 114 has `TRUNCATE ai_credit_balance, ai_credit_ledger`** —
   safe now (prod has NO AI-wallet data, feature never served), but **confirm prod wallets are empty first**
   and NEVER re-run 114 after real balances exist. (Metered charging: 114; est-price calibration: 115.)
3. `supabase functions deploy ai-generate`.
4. **Then** promote `develop`→`main` (web auto-deploys on main push). Mobile image features need a new
   **native EAS build** (expo-image-picker + expo-image-manipulator are native) — not OTA.
5. Post-deploy: run one real paid gen (top up a test wallet via `add_ai_credits`, generate, confirm the
   micro-WON deduction + a `spend` ledger row); wire the nightly Cloudflare-cron to    `refresh_ai_est_price()` (pg_cron not installed). A blind reconcile sweep was intentionally NOT built (would wrong-charge failed-but-unreleased gens without a delivery marker); the edge fn does an inline charge retry instead, and a rare lost charge is eaten as under-charge.

**Recommend a staged launch:** keep the free 10/day live first (wallet empty → paid path 402s cleanly),
turn on paid only once the payment webhook (§2) + pack SKUs exist. The free tier alone is safe to ship now.

## 4. Deferred UI + cleanup  (low)

- **Credit top-up button** — lands with payment 1c.
- **Mobile dead styles:** `SettingsScreen.tsx` still has orphaned `aiProviderCard` / `aiProviderHeader` /
  `aiProviderLeft` StyleSheet entries (lines ~1027–1030) left after the BYOK section was removed — delete.
- **Dead AI code (non-gen-path):** `packages/web/src/lib/ai/prompts.ts` is a **stale duplicate** of the
  canonical `packages/shared/lib/ai/prompts.ts` (missing Chinese/non-empty rules); plus unreferenced
  `lib/ai/ai-client.ts`, `secure-storage/*`, `provider-registry`. Remove in a cleanup pass.
- **L4 (cosmetic):** request-cap (23514) and insufficient-credits both surface as 429/402 with
  message-only distinction — fine; tighten copy if desired.
