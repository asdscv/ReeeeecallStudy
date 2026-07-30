# AI Monetization — Remaining Work

Builds on the completed engineering: [2026-07-01-ai-server-generation.md](../DONE/2026-07-01-ai-server-generation.md)
(Phase 0/1a/1b + image UI + tests/CI/e2e + the refund money-bug fix — all SHIPPED to `develop`, NOT prod).

Everything below is what's **left**. None of it blocks the shipped engineering; it's the
business/economic layer + external rails + ops + minor cleanup.

> **2026-07-30 확인**: 엔지니어링(Phase 0/1a/1b + metered billing + 이미지 UI + 테스트/CI/e2e)은
> `develop` 에 들어가 있다. 남은 §1 Phase 1(마진 ON)·§2 결제 provider 연동·§3 프로덕션 GO-LIVE 는
> **소유자의 사업 숫자·외부 계약·실제 과금**에 걸려 있어 자율 진행 대상이 아니다.
> §4/§5(저우선 UI 정리·리포팅 정확도)만 코드 작업이며, 과금 모델 확정 후 함께 다루는 것이 안전하다.

> **2026-07-31 재감사 (§2·§3 전면 개정, §4 마감, §5 보강).** 이 문서의 §2·§3 은 코드 현실보다
> 몇 달 뒤처져 있었다 — §2 는 "webhook NOT built / provider not chosen" 이라고 적혀 있었지만
> LemonSqueezy·Toss·RevenueCat 웹훅과 SKU 카탈로그·환불 정책·샌드박스 격리(mig 151~159)가 전부
> 들어가 있었고, §3 은 이미 오래 전에 적용된 마이그레이션 108–115 를 "적용하라"고 지시하고 있었다
> (그 중 mig 114 는 지갑을 TRUNCATE 한다 — stale 체크리스트가 위험한 이유).
>
> 같은 감사에서 **실제 머니 버그**를 찾아 고쳤다: RevenueCat 환불이 한 번도 클로백되지 않고 있었다
> (§2, PR #350). §4 의 죽은 코드 항목은 닫혔고(#349 + 2026-07-31 후속), §5 에는 순액 리포팅을
> `payment_intents` 컬럼으로 만들면 모바일 절반을 놓친다는 사실과, 환불된 크레딧팩이 어드민
> 목록에서 여전히 `paid` 로 보이는 별건 버그를 적었다.
>
> ⚠️ **이 문서는 프로덕션 상태의 근거가 아니다.** §3 의 표는 과거 PR 기록의 요약일 뿐이며,
> 무엇을 적용하기 전에 실제 DB 를 확인해야 한다.
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

## 2. Payment rails — Phase 1c  ✅ BUILT (web + mobile) / ⏳ provider accounts + go-live are owner work

> **Rewritten 2026-07-31.** This section described a plan ("provider not chosen", "webhook NOT
> built") that the repo overtook months of work ago. What is actually in `develop` today:
>
> | Rail | Code | Verification |
> |---|---|---|
> | Web checkout | `lib/payments/{lemonsqueezy,toss,portone,mock}-provider.ts` behind a `VITE_PAYMENT_PROVIDERS` registry (first id = primary) | provider unit tests |
> | Web webhooks | `lemonsqueezy-webhook`, `toss-webhook` (+ `toss-billing` / `toss-confirm` / `toss-renew`) | `payment_edgecase_test.sql`, `billing_sku_catalog_test.sql` |
> | Mobile IAP | `services/purchases.ts` (RevenueCat SDK) + `WalletSummary` | `revenuecat_webhook_e2e.py` |
> | Mobile webhook | `revenuecat-webhook` — fail-closed on `REVENUECAT_WEBHOOK_AUTH`, per-user `original_transaction_id` keying, store + environment attribution | `revenuecat_webhook_e2e.py` (60 assertions), `sandbox_environment_test.sql` |
> | Generic seam | `payment-webhook` (HMAC-SHA256, fail-closed until `PAYMENT_WEBHOOK_SECRET`) — kept for a provider that has no dedicated function | `payment_webhook_e2e.sh` 11/11 |
> | Credit top-up UI | web `components/billing/TopUpModal.tsx`, mobile `WalletSummary` | web vitest |
> | SKU catalog | mig 151 + 155 (`billing_product_skus`, `resolve_store_product`, platform-specific ids) | `billing_sku_catalog_test.sql` |
> | Channel / refund policy | mig 156 (`platform`, `_billing_channel`), mig 157 (refund eligibility; iOS is revoke-only, Play has a money API) | `refund_policy_test.sql` |
> | Refund-before-grant guard | mig 158 `credit_grant_is_refunded()` | `credit_refund_guard_test.sql` |
> | Sandbox isolation | mig 159 (`environment` column, default-off `sandbox_grants_enabled`, sandbox out of every business metric) | `sandbox_environment_test.sql` |
>
> The original plan's PortOne-only web assumption did not survive: web ships LemonSqueezy and
> Toss adapters as well, and which of them is live is an env decision, not a code change.

**Money bug found and fixed while auditing this (PR #350, mig 173).** RevenueCat has **no
`REFUND` event type** — a store refund arrives as `CANCELLATION` with
`cancel_reason=CUSTOMER_SUPPORT` and a negative `price`. The webhook branched on
`event.cancellation_reason`, a key RevenueCat does not send, so **every real refund fell into
the plain auto-renew-off arm**: a refunded credit pack was never clawed back and a refunded
subscription kept its raised card cap until period end. The e2e suite was green because it
synthesised `type: "REFUND"`, the one shape that never arrives. Reproduced against the served
function (purchase → 990000, refund → still 990000, zero reversal rows). The same PR adds
`REFUND_REVERSED` handling (`reverse_credit_clawback`, mig 173) — previously unhandled, so a
store-reversed refund left the customer paid-up with nothing and no code path could restore it.

**⏳ What is genuinely left here, and none of it is engineering:**

- App Store / Play Console product setup and **Apple review** for the consumable packs;
- the RevenueCat project + `REVENUECAT_WEBHOOK_AUTH` secret, and pointing the webhook at the
  deployed function (sandbox first — mig 159 makes leaving the sandbox webhook on permanently
  safe, because its events are acked and grant nothing until an admin opens the kill switch);
- the payment provider account(s) for web + their secrets;
- the pack tiers and prices (owner decision, §1).

**⚠️ Still true about the generic `payment-webhook` seam:** its default is hex-HMAC over the raw
body with header `x-webhook-signature`. A provider that signs differently (PortOne v2 is svix
over `${id}.${ts}.${body}`) currently **fails closed**, which is the safe direction, but the
scheme has to be swapped in before that provider can be used. Where the signature does not cover
the amount, the body amount must be replaced by server-side re-verification (the dedicated
LemonSqueezy / Toss / RevenueCat functions already resolve the amount from the DB catalog, not
from the payload).

## 3. Production deployment — GO-LIVE CHECKLIST  ⚠️ OWNER-GATED (outward-facing, real money)

> **Rewritten 2026-07-31.** The old checklist told the owner to apply migrations 108–115,
> which the repo's own deployment records say happened long ago. Keeping a stale checklist
> here is worse than having none: it invites re-running a migration that TRUNCATEs the wallet.
>
> **This document cannot be trusted as the prod state.** Nothing here is verified against the
> production database — it only summarises what earlier PRs recorded. Re-read the actual
> `supabase_migrations` state before applying anything.

**What the records say is already on prod**

| Migrations | Record |
|---|---|
| 108–115 (metered wallet, cost ledger, est-price) | shipped with the AI generation rollout |
| 148–155 (card cap, plan names, SKU catalog, quotas, flags) | `DOCS/TODO/HANDOFF-2026-07-29-billing-ui-deploy.md` — "148–155 전부 적용됨", confirmed pre-deploy |
| 161 + 171 (study write contract, expand → contract) | #351 / #353 |
| 170 (drop `user_ai_provider_keys`, BYOK retirement) | #353 — "prod done (2026-07-31)", `ai-keys` endpoint now 404 |

**Not applied, deliberately**

- **165–169 — the learning engine.** Stated as unrun in the learning design and validation
  documents, and it stays that way until the owner authorises it.
- **172 (goal↔deck writers, PR #354)** and **173 (credit clawback reversal, PR #350)** — open PRs.
- ⚠️ **mig 114 must NEVER be re-run.** It contains `TRUNCATE ai_credit_balance, ai_credit_ledger`.
  It was safe exactly once, when prod had no wallet data. It is not safe again.

**Remaining go-live order (unchanged where it still applies)**

1. `supabase secrets set AI_GENERATION_PROVIDER_KEY=<gemini key>` (registry defaults to **gemini**,
   ~6× cheaper than Grok; the owner-provided key lives in the gitignored `.env.local`, never the repo).
   Usage measurement is verified for both providers (text + vision), so `ai_cost_ledger` prices either.
2. `supabase functions deploy ai-generate` — plus `revenuecat-webhook` when mobile IAP goes live, and
   whichever web payment webhook the enabled provider needs (§2).
3. **Then** promote `develop`→`main` (web auto-deploys on a main push). Native mobile changes need a
   new EAS build; JS-only changes reach existing installs by OTA (see the handoff doc — this was
   mis-stated once before and the difference decides whether users get anything at all).
4. Post-deploy: one real paid generation (top up a test wallet via `add_ai_credits`, generate, confirm
   the micro-USD deduction and its `spend` ledger row); wire the nightly Cloudflare cron to
   `refresh_ai_est_price()` (pg_cron is not installed). A blind reconcile sweep was intentionally NOT
   built — without a delivery marker it would wrong-charge failed-but-unreleased generations; the edge
   function retries the charge inline instead and a rare lost charge is eaten as an under-charge.
5. Mobile paid rails additionally need the sandbox run described in §2 **before** the kill switch is
   opened for production grants.

**Staged launch still recommended:** the free 10/day tier is safe on its own (an empty wallet 402s
cleanly on the paid path); turn paid on only once the provider accounts and pack SKUs exist.

## 4. Deferred UI + cleanup  (low)

- **✅ Credit top-up button — shipped.** Web `components/billing/TopUpModal.tsx` (lists the
  `credit_pack` catalog with $ price + credits granted) and mobile `WalletSummary`.
- **✅ BYOK removal finished (2026-07-30, branch `chore/remove-byok`)** — the "connect your own AI
  provider key" feature is **retired end to end**, not just off the generation path:
  - **Customer-facing copy**: the mobile guide still shipped an *"API 키 설정"* + *"무료 Gemini API 키 발급"*
    walkthrough in all 8 locales (rendered by `GuideScreen`), and the web guide's `ai-generate.what` /
    `fullGenerate` bodies still told users to paste a key. Both rewritten to server-side generation
    (free daily cards + credit balance).
  - **Dead i18n**: mobile `settings.json` `aiProviders` block ×8 deleted (web locales were already clean).
  - **Dead code**: web + shared `lib/ai/{secure-storage/**,providers/**,provider-registry,ai-client,
    ai-key-storage}` + their tests deleted; BYOK-only types pruned from both `lib/ai/types.ts`;
    unreferenced duplicate `shared/lib/guide-content.ts` (still had `apiKeySetup`/`geminiSetup` pointing at
    i18n keys and screenshots that no longer exist) deleted.
  - **Backend**: `supabase/functions/ai-keys` deleted + mig **170** drops `user_ai_provider_keys`, the 6
    RPCs, and the plaintext-passphrase table `_ai_encryption_config` (closes SECURITY-REMAINING **H1c**).
  - **E2E**: `ai-provider-settings.spec.ts` deleted; `ai-generate` / `capture-guide-screenshots` specs
    de-BYOK'd (gate `E2E_GROK_API_KEY` → `E2E_AI_GENERATION`).
  - Note: the `SettingsScreen.tsx` orphaned `aiProviderCard/Header/Left` styles this doc previously listed
    were **already gone** — that entry was stale.
  - **✅ prod done (2026-07-31)**: mig 170 applied, `ai-keys` edge function deleted (endpoint → 404),
    `AI_KEY_PASSPHRASE` secret removed. Shipped to `main` (PR #349 → #352). SECURITY-REMAINING **H1c is closed**.
- **✅ Dead AI code (non-BYOK) — done 2026-07-31.** `packages/web/src/lib/ai/prompts.ts` and
  `validators.ts` were imported by nothing but their own tests, and `prompts.ts` had already drifted
  from the canonical `shared/lib/ai/prompts.ts` (it had lost the Chinese template/card rules, so a
  Chinese deck built through it would have had no dedicated 汉字 field). Both deleted; `types.ts`
  became a re-export (seven live web components import it); both test suites RETARGETED at the
  canonical modules rather than deleted with the copies — they were that code's only coverage.
  Three assertions were added for exactly what the drift had lost.
- **L4 (cosmetic):** request-cap (23514) and insufficient-credits both surface as 429/402 with
  message-only distinction — fine; tighten copy if desired.

## 5. Admin revenue-reporting caveat  (accuracy, post-launch — low)

The admin billing dashboard sums **catalog USD** as "revenue" (`get_admin_billing_kpis` →
`SUM(price_usd_cents * 10000)` / `payment_intents.amount_micro_won`, mig 145/147). That figure is
the LIST price we advertise, **not the actual net we receive**. For a mobile IAP the real receipt is:

    현지 통화 결제액  −  애플/구글 수수료(≈15–30%)  −  환율 스프레드  =  실수령 순액

So a "$0.99 pack" shows as $0.99 revenue, but nets us ≈ $0.70 (or less). **Money movement is
correct** — the user is granted exactly the catalog USD and deductions are real-usage USD; this is
purely a *reporting* gap. Ledger/wallet math is unaffected.

Fix when settlement accuracy is needed (not before launch). Two notes for whoever picks this up,
both learned while auditing the RevenueCat webhook on 2026-07-31:

- **`payment_intents` is the wrong home for the mobile half.** An IAP consumable opens **no**
  `payment_intents` row — the `ai_credit_ledger` grant *is* the payment record (that is why mig 156
  stamps `platform` on the ledger). A `net_proceeds_micro_usd` column on `payment_intents` would
  therefore capture web receipts only. A provider-agnostic settlement table keyed on
  `(provider, provider_event_id)` — linkable to a ledger ref, a subscription id, or a merchant_uid —
  covers both shapes, and RevenueCat hands over everything it needs: `price` (USD, negative on a
  refund), `currency`, `price_in_purchased_currency`, `tax_percentage`, `commission_percentage`
  (all documented as "Sometimes" present, so parse defensively and record what is missing rather
  than assuming zero).
- **A separate, smaller reporting bug to fix in the same pass:** `admin_list_payments` hard-codes
  `status = 'paid'` for every credit-pack row it lists (mig 159's body), so a **refunded** pack still
  shows as paid in the admin payment list. The clawback row exists in the ledger; the list just does
  not look for it.

Until then, treat the admin revenue number as **gross list price**, not net receipts.
