# AI Server-Side Generation + Monetization

**Standard:** [DOCS/STANDARD/ARCHITECTURE.md](../STANDARD/ARCHITECTURE.md)
**Status:** ✅ COMPLETE (engineering) — Phase 0 + 1a + 1b + image UI + hardening/tests/e2e all SHIPPED to `develop`. Remaining work tracked in [AI-MONETIZATION-REMAINING.md](../TODO/AI-MONETIZATION-REMAINING.md) (payment 1c + cost/margin/pricing layer + prod deploy — none are blockers in this doc's scope). See §16 for the final record.

## 1. Goal
Replace **BYOK** (each user enters their own AI API key — kills conversion) with
**server-side generation on our key**, metered and ready to monetize.

### Locked product decisions
- **Free:** 10 generated **cards/day/account** (text generation). Decks/templates
  are not the costly part → free, abuse-capped only.
- **Paid (Phase 1):** cards beyond the daily 10; **image-upload → vision
  recognition → cards** (always paid, a NEW feature). Pay-as-you-go **prepaid
  wallet**, deducted on use.
- **Payment rail (Phase 1):** Strategy A — store-compliant. Web = PortOne
  (카드/카카오/네이버/토스); mobile = Apple IAP + Google Play Billing (RevenueCat),
  consumable top-ups. Single server wallet unifies web + app balance. (KR bans
  out-links; margin ~99% so the store cut is affordable.)
- **Provider:** Gemini **2.5 Flash-Lite** (text), Gemini Flash (vision, Phase 1).
  Measured cost ≈ ₩1/full generation. Free Gemini tier ≈ 1,500 req/day.
- **BYOK:** removed from the generation path; provider becomes a config-driven
  seam (a disabled "use my own key" strategy could return later — out of scope).

## 2. Architecture
```
 web / mobile  ──(JWT)──▶  edge fn `ai-generate`  ──▶  record_ai_generation() RPC  (meter, 429 if over)
   (no API key)               │                          server-built prompt
                              └──▶ Gemini (server GEMINI_API_KEY) ──▶ { content: <JSON> }
```
- Client sends **structured params** (kind, topic, fields, count…), NOT raw
  prompts. The **server builds the prompt** → prevents prompt-injection / using
  our key as a free general LLM.
- Mirrors the `tts` edge pattern (JWT auth → metering RPC → provider → respond).

## 3. Data model — migration `108_ai_generation_usage.sql` (DONE, written)
- `ai_generation_usage(user_id, usage_date, free_cards_used, paid_cards_used,
  image_jobs, req_count)` — deny-all RLS.
- `record_ai_generation(p_kind, p_cards) → remaining_free` — SECURITY DEFINER,
  free 10/day hard ceiling (Phase 0), req cap 300/day, RAISE rolls back.
- `get_ai_generation_quota() → (free_limit, free_used, remaining)` — read-only.
- `_ai_free_cards_per_day()` — single source for the limit (Phase-1 config seam).

## 4. Client ↔ server contract (`POST /functions/v1/ai-generate`)
Auth: `Authorization: Bearer <user JWT>`.
```jsonc
// request
{ "kind": "template|deck|cards",
  "topic": "string", "uiLang": "ko",
  // template: "useCustomHtml"?, "contentLang"?, "fieldHints"?
  // cards:    "fields": [...], "cardCount": 1..25, "existingCards"?: [...] }
// response 200
{ "content": { /* template|deck|cards JSON, already parsed */ }, "remainingFree": 8 }
// errors: 401 unauth · 400 bad request · 429 {code:"AI_FREE_QUOTA_EXCEEDED"|"AI_RATE_CAP"} · 502 provider
```
- Cards are generated in batches of ≤25 (existing store loop). Each batch =
  one call metered by its card count. Client pre-checks `get_ai_generation_quota`
  and caps the count selector to `remaining` in Phase 0.

## 5. Work plan (tasks #1–#8)
- [x] #1 Design docs (this file + STANDARD)
- [x] #2 Migration 108 — metering table + RPCs
- [x] #3 Edge fn `ai-generate` + `_shared/ai-prompts.ts` (server prompt builder) + deno.json + config.toml secret wiring
- [x] #4 Shared `callServerAI`/`getAiGenerationQuota` + refactor `ai-generate-store` off BYOK (removed `getConfig`/`aiConfigManager`/`setAIConfigCache`)
- [~] #5 Web: **generation path de-BYOK'd** (ConfigStep, AIGeneratePage, store re-export). **REMAINING: remove the AI-provider key section in `SettingsPage.tsx`** (keep the rc_ REST-API-key section — different feature). Free-quota display deferred (server enforces; error fallback covers).
- [~] #6 Mobile: **AIGenerateScreen de-BYOK'd**. **REMAINING: remove AI-provider key section in `SettingsScreen.tsx`**.
- [x] #7 Tests — all green (see Verification)
- [ ] #8 Zero-Defect audit (3-phase) + merge cycle — pending Phase 0 completion + live key

## 5b. Verification (run 2026-06-30)
- **Migration 108 on a real Postgres** (throwaway pgvector/pg15 container): applies clean; 6 metering assertions PASS — free-10 accrual + remaining, 11th-card `check_violation` **with rollback** (rejected call consumes nothing), template/deck don't consume card quota but bump `req_count`, quota read, per-user isolation, invalid-kind reject. → `ALL_108_TESTS_PASSED`.
- **Server prompt-builder parity** (`server-prompts-parity.test.ts`): 6/6 — server `_shared/ai-prompts.ts` is byte-identical to the canonical shared builder (template/deck/cards incl. Chinese + dedup).
- **Typecheck**: web `tsc -b --force` exit 0; mobile `tsc --noEmit` exit 0.
- **Regression**: AI lib suite 60/60; i18n key parity 135/135 (no locale files changed).

## 5c. Notes / found issues
- **`packages/web/src/lib/ai/prompts.ts` is STALE** vs `packages/shared/lib/ai/prompts.ts` (missing the non-empty-field rule + Chinese guidance). It is NOT used at runtime for generation (the shared store + shared prompts are), so harmless — but the parity test initially failed against it. The server builder tracks the SHARED (canonical) version. Cleanup: delete the web duplicate or resync (out of scope here).
- Now-unused (left as dead code, not on the generation path; remove in a cleanup pass): shared/web `lib/ai/ai-client.ts`, `secure-storage/*`, `provider-registry`, `prompts.ts` orphaned i18n keys.

## 5d. Remaining before merge (external / follow-up)
1. Settings AI-key section removal (#5/#6 remainder).
2. **`AI_GENERATION_PROVIDER_KEY` (Gemini)** set as a Supabase Edge secret → only then can live generation + an integration test run.
3. Apply mig 108 to prod (confirmed step) + `supabase functions deploy ai-generate`.
4. 3-phase Zero-Defect audit, then merge cycle.

## 6. Security
- Server-built prompts (no client-supplied prompt text reaches the model).
- JWT auth; metering RPC runs as the user (`auth.uid()`), deny-all table.
- Daily free ceiling + request cap bound provider cost/abuse.
- `GEMINI_API_KEY` server-only (Deno.env / Supabase secret); never shipped to client.
- CORS allowlist (`ALLOWED_ORIGINS`).

## 7. Testing strategy (no coverage-padding)
- RPC: free-quota boundary (10 ok, 11 raises + rolls back), req cap, template/deck
  not card-metered, quota read. (local `supabase`/pgTAP or SQL harness).
- Unit: server prompt builders == client builders for same inputs (sync-guard);
  request body validation; store generates with no API key configured.
- i18n parity (`translation-keys.test.ts`).

## 8. Rollout / external dependencies
- **Needs from owner:** `GEMINI_API_KEY` set as a Supabase Edge secret
  (`supabase secrets set GEMINI_API_KEY=…`). Without it, live generation can't run
  (code + unit tests are independent of it).
- Deploy: `supabase functions deploy ai-generate`; apply mig 108 to prod
  (separate, confirmed step — not auto-applied).

## 9. Phase 1 (out of scope here — design seam only)
Wallet `ai_credit_balance` + append-only `ai_credit_ledger`; top-up via PortOne
(web) + IAP/RevenueCat (mobile) crediting the wallet; `record_ai_generation`
over-free branch deducts from balance; image-recognition edge route (vision model)
metered as `image_jobs`, always paid.

## 10. Zero-Defect audit (2026-06-30) — 19 raw → 13 confirmed (0 crit / 0 high / 3 med / 8 low)
Multi-agent adversarial audit (DB/security · edge-fn · shared/store · client/dead-code),
each finding verified to drop false positives. **No merge blockers.** Fixed:
- **M1** quota burned on provider failure → `refund_ai_generation` RPC (mig 108) + edge catch refund.
- **M2** multi-batch (>25) lost earlier cards on a later-batch error → store keeps partial results (`review_cards`), only errors if 0 generated.
- **M3** full-mode 0-quota user wasted template+deck calls → `generateTemplate` quota pre-check (fail fast).
- **L1** no provider timeout → `AbortController` (30s) in `providerRequest`.
- **L2** unbounded input → caps on field key/name + `existingCards` size (`asExistingCards`).
- **L3** unvalidated `fieldHints` (→500) → `asFieldHints` validator (→400).
- **L5** network failure misclassified → `FunctionsFetchError` → `NETWORK_ERROR` mapping.
- Deferred (cosmetic/UX, noted): **L4** dup SQLSTATE for cap vs quota (both 429, message only); **M3 part-1** visible remaining-quota number in ConfigStep/AIGenerateScreen (needs 8-locale i18n) — server enforces + English fallback covers; a few additional lows.
Re-verified after fixes: metering **+ refund** on real Postgres (`ALL_108_TESTS_PASSED`, T1–T7), web+mobile `tsc` exit 0, prompt parity 6/6 + AI suite 60/60.

## 11. Phase 0 STATUS = implementation complete + audited + verified
Remaining before it can SERVE in prod (external / owner): set `AI_GENERATION_PROVIDER_KEY`
edge secret (Gemini key — none found in env; verified live via Grok since the edge fn is
provider-agnostic), apply mig 108 to prod, `supabase functions deploy ai-generate`. A full
local-supabase end-to-end (`supabase start` + `functions serve`) is the one untested seam
(components individually verified).

## 12. Provider/model extensibility (registry)
`supabase/functions/_shared/ai-providers.ts` = the seam that makes provider/model
"easily extensible anytime":
- **Add a provider** = one entry in `PROVIDERS` (id → baseUrl + default text/vision models).
  Ships with gemini · xai · openai · deepseek · openrouter (all OpenAI-compatible).
- **Switch at runtime, no redeploy** — all knobs are Supabase edge secrets:
  `AI_GENERATION_PROVIDER` (id, default gemini) · `AI_GENERATION_PROVIDER_KEY` · `AI_GENERATION_MODEL`
  · `AI_VISION_MODEL` (Phase-1 image path) · `AI_GENERATION_BASE_URL` (custom endpoint override).
- `resolveModel(purpose, env)` is pure + unit-tested (`server-providers.test.ts`, 7 cases):
  per-purpose (text vs vision) model selection, defaults, overrides, null→503.
- Phase-1 vision/image-recognition already has its model seam (`AI_VISION_MODEL` / `resolveModel('vision')`).
- Future option (not built): a DB `ai_generation_config` table for per-tier/A-B model routing
  without touching secrets.

## 13. Phase 1a — prepaid credit wallet + pay-as-you-go overage (SHIPPED to develop)
Cards beyond the daily free 10 now spend prepaid credits instead of hard-failing.
- **mig 109**: `ai_credit_balance` (deny-all, CHECK balance>=0) + `ai_credit_ledger`
  (append-only audit) + `add_ai_credits` (**service_role / admin only** — for payment
  webhooks & IAP validation; never a plain user) + `get_ai_wallet` + `_ai_credits_per_card`
  (config seam, 1 credit/card default).
- `record_ai_generation` redesigned: splits each call free-vs-paid; the paid portion
  debits credits **atomically** (`UPDATE … WHERE balance>=need`, row-locked via
  `SELECT … FOR UPDATE`); insufficient → `P0002` RAISE (rolls back, consumes nothing).
- edge fn: `P0002`→402 `AI_INSUFFICIENT_CREDITS`, `23514`→429 `AI_RATE_CAP`.
- shared: `getAiWallet` + `getAffordableCards` (free remaining + credits/card); store
  caps generation to affordable (was free-only), maps the insufficient-credits error.
- Verified: wallet/overage on real Postgres (`ALL_109_TESTS_PASSED`, T1–T9), web+mobile
  `tsc` exit 0, AI suite 67/67. (Visible balance widget deferred to the payment-UI phase.)

## 14b. Phase 1b — image recognition → cards (backend SHIPPED to develop)
Upload an image → vision model extracts content → flashcards. **Always paid** (no free).
- **mig 110**: `_ai_credits_per_image` (5) + `record_ai_image` (debit credits, bump
  `image_jobs`, `spend_image` ledger, insufficient → P0002) + `refund_ai_image` +
  `get_ai_wallet` extended with `credits_per_image`.
- edge fn `kind:'image'`: `resolveModel('vision')`, validate data-URL image (size cap)
  + fields, meter, OpenAI-compat `image_url` message, refund on failure.
- `buildImageCardsPrompt`; shared `callServerAI` image kind + `store.generateCardsFromImage`.
- Verified: `ALL_110_TESTS_PASSED` (real PG) + **LIVE Grok vision e2e** (real vocab image
  → 5 correct cards) + web+mobile tsc. **Remaining: image-upload UI (web wizard step +
  mobile expo-image-picker)** — backend + client API done, UI is a focused follow-up.

## 14c. Deferred UI (consolidated follow-up)
- Visible remaining-free-cards + wallet balance widget (ConfigStep / AIGenerateScreen) — 8-locale i18n.
- Image-upload entry + picker (web + mobile) wiring `store.generateCardsFromImage`.
- Credit top-up button (lands with payment 1c).

## 15. Remaining Phase 1
- **1c** payment rails — web PortOne + mobile Apple IAP / Google Play Billing (RevenueCat),
  crediting the wallet via `add_ai_credits` (service_role). Strategy A; Korea bans out-links.
  **External: merchant/store credentials + product setup + Apple-review (RevenueCat was rejected).**
- Pricing: set ₩/credit + credits-per-image at the payment layer (`_ai_credits_per_card` is the card seam).
- **Cost/margin/pricing extensibility** — capture real provider cost per call + configurable margin
  per provider/model (NEW requirement; see [AI-MONETIZATION-REMAINING.md](../TODO/AI-MONETIZATION-REMAINING.md)).

## 16. Final record (2026-07-01) — engineering COMPLETE, all merged to `develop` (NOT prod)
Phase 0/1a/1b + image UI shipped earlier (PRs #198–#203). The closing "everything except payment" pass:
- **DB money-logic tests → CI** (PR #204): `supabase/tests/ai_credit_metering_test.sql` (single-session
  psql ASSERT suite over the final 108→111 schema) wired as ci.yml job `ai-credit-tests` (plain
  postgres-15 + bootstrap-auth + full migration chain). Green on the real runner.
- **Mobile fast-follows** (PR #205): `expo-image-manipulator` dimension downscale (≤1600px longer side)
  + deck-own `default_template_id` only (no `templates[0]` fallback; `cardsOnlyNeedsTemplate` guard +
  `alert.deckNoTemplate` ×8 locales).
- **⚠️ CRITICAL money-bug fix** (PR #206): refund-on-provider-failure was DEAD —
  `sbServiceRole().rpc(...).catch(...)` threw "catch is not a function" (the supabase-js builder is
  thenable but has no `.catch`), so a failed generation never refunded the user. Fixed via a `refundJob()`
  helper (await + inspect `{error}`). **Rule: never `.rpc(...).catch(...)` on a supabase-js builder.**
  Caught by a new local e2e: `supabase/tests/ai_generate_edge_e2e.sh` (manual — needs a live provider key
  + `supabase start`; 14/14 PASS: auth/validation/happy-metered-as-user/over-free-402/paid-debit/refund).
- Settings BYOK removal (§5/§6) + remaining-free/wallet affordance line (§14c) — both done.

**Before prod can SERVE** (external/owner ops, unchanged): set `AI_GENERATION_PROVIDER_KEY` edge secret,
apply migs 108–111 to prod, `supabase functions deploy ai-generate`. Until then → graceful 503.

**Still open (own trackers):** payment 1c + the cost/margin/pricing layer → [AI-MONETIZATION-REMAINING.md](../TODO/AI-MONETIZATION-REMAINING.md).
