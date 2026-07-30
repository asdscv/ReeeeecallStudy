# Customer External API Removal Design

**Date:** 2026-07-29  
**Status:** Approved implementation plan  
**Scope:** Remove the customer/developer REST API authenticated with `rc_...` keys. Preserve internal app JWT edge functions and unrelated provider/platform credentials.

## 1. Decision

ReeeeecallStudy will not expose a customer-facing programmable REST API. The removed contract is the former `Authorization: Bearer rc_...` flow, API-key management, developer API documentation, and customer API marketing.

Retained and explicitly out of scope:

- Supabase app JWT/anon-key transport used by web/mobile.
- JWT-authenticated internal edge functions including `ai-generate` and `tts`.
- Server-only provider credentials such as `GEMINI_API_KEY`, payment keys, RevenueCat keys, and App Store Connect deployment keys.
- AI-provider BYOK storage that may still exist as an internal/legacy product capability; it is not an `rc_` customer API credential.
- `api_rate_limits` / `check_rate_limit`, because `_shared/ops-gate.ts` uses them as an internal edge-function abuse guard.

## 2. Current-state audit

### Already removed before this change

- `supabase/migrations/117_ai_wallet_summary_drop_api.sql` already drops `public.resolve_api_key(text)` and `public.api_keys CASCADE`, and removes API-key counts from `admin_system_stats()`.
- `supabase/functions/api/` does not exist in the current tree.
- No customer API-key store or API docs route/page remains in `packages/web/src/App.tsx` or `packages/shared/stores`.
- No active code imports `packages/shared/lib/api-docs-content.ts`; it is orphaned.

### Remaining customer-facing surface

- `packages/shared/lib/api-docs-content.ts`: complete orphaned REST API documentation, including `rc_` examples.
- `packages/shared/lib/guide-content.ts`: stale `settings.items.apiKey` entry and full `id: 'api'` guide section linking to `/docs/api`.
- `packages/web/src/lib/__tests__/guide-content.test.ts`: asserts the stale API guide section.
- `packages/web/public/locales/*/settings.json`: stale `links.apiDocs`, `links.apiDocsDesc`, and `apiDocs` content.
- `packages/mobile/src/i18n/locales/*/settings.json`: stale `apiDocs` and `apiDocsDesc` keys.
- `packages/web/public/locales/*/landing.json`: footer/API-doc key; English/Korean additionally advertise external API-key integration.
- `worker.js`, `worker-modules/seo/page-registry.js`, `worker-modules/seo/sitemap.js`, `worker-modules/seo/handlers/landing.js`, `packages/web/index.html`, and `packages/web/public/llms*.txt`: the stale `/api/*` → removed Supabase `functions/v1/api` proxy, `/docs/api` bot route, sitemap/noscript/LLM-crawler entries, and bot-rendered landing footer link.
- `packages/web/e2e/tests/settings-auto-save.spec.ts`: stale API docs settings navigation assertion.
- `packages/web/e2e/tests/admin-dashboard.spec.ts`: stale customer API-key admin section assertion.
- `API_PLAN.md`: obsolete implementation plan for the removed external API.
- Historical migrations `006`, `007`, `030`, `036`, `098`, `102`, `107` and completed/security history documents describe the former feature. Applied migrations are immutable and historical records are not rewritten.

## 3. Removal sequence

1. Remove orphaned customer API documentation and tests.
2. Remove guide/settings/footer/landing and SEO sitemap/bot-footer references in every locale/surface while preserving JSON parity.
3. Remove stale E2E assertions.
4. Add migration `169_remove_customer_external_api_contract.sql` as an idempotent security contract:
   - revoke all execution on `resolve_api_key(text)` if a drifted environment still has it;
   - drop `resolve_api_key(text)`;
   - drop `api_keys CASCADE`;
   - leave internal `api_rate_limits` intact.
5. Do not recreate credentials on rollback. The rollback documents that credential hashes/plaintext cannot be safely restored; restoring the feature requires a new reviewed expand migration and newly issued credentials.

## 4. Security and data handling

`api_keys` was already removed by migration 117. Migration 169 is defense-in-depth for drifted databases and is intentionally destructive. No remote migration is run by this work. Before applying to an environment that predates migration 117, operators should export only metadata needed for audit/notification; raw keys cannot be recovered from hashes and must not be backed up as plaintext. Users would need newly issued credentials if the feature were ever reintroduced.

No project code, keys, user data, or database contents are transmitted externally during implementation.

## 5. Rollout and rollback

- Source rollout order: UI/docs/tests first, then contract migration.
- Deployment is explicitly outside this task.
- Rollback removes no learning/internal JWT capability. The down migration is a no-op with a warning because resurrecting customer authentication from stale/unknown key material is unsafe.
- Existing `/docs/api` external content may remain on an independently deployed site/CDN; it must be removed or redirected separately because it is not present in this repository.

## 6. Verification

- Repository search has no customer `rc_` bearer example, `resolve_api_key`, active `api_keys`, `/docs/api`, or API docs content outside immutable historical migrations/docs and the removal migration/design.
- Guide tests no longer expect an API section.
- Web/mobile locale parity and JSON parsing pass.
- Web typecheck and build pass.
- Local migration applies and confirms `to_regclass('public.api_keys') IS NULL`, no `resolve_api_key` function, and internal `check_rate_limit` remains.
- Internal `ai-generate` and `tts` functions remain present.

## 7. Acceptance criteria

1. A customer cannot create, view, use, or discover an `rc_` API key in app code or documentation.
2. No customer API edge endpoint exists or is configured.
3. No customer API schema/function/grant remains after migration 169.
4. Internal app JWT functions and internal rate limiting are unchanged.
5. All locales and tests are updated consistently.
6. No commit, push, deployment, or remote migration occurs.
