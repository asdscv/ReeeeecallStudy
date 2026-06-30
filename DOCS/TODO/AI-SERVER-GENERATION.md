# AI Server-Side Generation + Monetization

**Branch:** `feat/ai-server-gen-phase0` · **Standard:** [DOCS/STANDARD/ARCHITECTURE.md](../STANDARD/ARCHITECTURE.md)
**Status:** Phase 0 in progress.

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
