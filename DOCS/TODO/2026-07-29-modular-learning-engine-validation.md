# Modular Learning Engine — Implementation Validation and Audit

**Date:** 2026-07-29  
**Branch/worktree:** `feat/modular-learning-engine-foundation` in `modular-learning-engine`  
**Scope:** migrations 160–164, shared learning core, atomic study recording, planner/evaluators/domain adapters, AI remediation, customer external API removal, web/mobile compatibility.

No commit, push, deployment, remote migration, or remote data operation was performed.

## 1. Zero-Defect Audit

### 1.1 Deep Dive

The initial implementation audit found and corrected:

- rating retries compared only a partial payload; migration 161 now stores/compares the full client rating payload and serializes `(user, client_rating_id)` retries with an advisory transaction lock;
- attempt retries compared only target/type fields; migration 162 now compares goal/targets, response, score, evaluator result, feedback, hints, duration, and evaluator version, with an advisory lock on `(user, client_attempt_id)`;
- plan-item attempt validation omitted activity/response/evaluator snapshots; all are now checked;
- goal create/unarchive cap checks were not serialized and lifecycle transitions were too loose; per-user advisory locking, a stable transition graph, archived immutability, and unarchive cap enforcement were added;
- plan saves did not explicitly reject empty `reason_code`, out-of-range priority, or non-positive duration and did not normalize JSON `null` payloads; all are now explicit;
- rollback 160 was not safe after a partial migration failure; `ALTER TABLE IF EXISTS` now makes cleanup partial-state safe;
- the pure planner may return a successful empty plan while persistence rejects zero items; design §21.8 now explicitly defines that no-work plans are not persisted.

### 1.2 Double-Check

Concurrency, retries, side effects, and compatibility were rechecked:

- atomic rating writes progress and the study log in one transaction; stale state produces no write;
- duplicate SRS and non-SRS ratings return the prior result without another log;
- duplicate attempts do not increment usage or plan aggregates twice;
- completed plan items update completion attempt, item state, and plan aggregates atomically;
- shared and web study stores await persistence before queue advancement and preserve retry IDs;
- official/shared source content is not mutated; AI output persists only as user enrichment;
- `ActivityType` remains independent from legacy `StudyMode`;
- activity-only/non-card planning remains supported;
- future audio/STT/pronunciation ports compile but unsupported capabilities fail explicitly;
- remediation persistence now applies the same archived-goal and shared-concept goal-link access rules as reservation.

An independent SQL/security auditor and architecture auditor both returned `APPROVED` with no blocking findings. Their one actionable defense-in-depth observation (remediation concept access asymmetry) and two style observations (store indentation) were fixed and revalidated.

### 1.3 Lockdown

Security and contract-removal checks found and corrected additional active discovery/proxy surfaces outside the original scanner roots:

- removed the Cloudflare Worker `/api/*` proxy to the retired Supabase `functions/v1/api` endpoint;
- removed the bot `/docs/api` registry entry;
- removed `/docs/api` from static sitemap, bot landing footer, and web noscript navigation;
- added worker regression tests proving `/api/*` falls through to assets without outbound proxying and `/docs/api` is neither registered nor advertised.

Final checks confirm:

- all new RPCs use fixed `search_path`, caller/ownership checks, and explicit grants/revokes;
- all 11 migration-160 tables have RLS enabled;
- `anon` cannot execute rating/goal/plan/attempt RPCs while `authenticated` receives only intended RPC execution;
- `api_keys` and `resolve_api_key` are absent;
- active customer API references are zero across packages, prototype source, edge functions, worker modules, and worker entrypoint;
- internal app JWT functions, AI-provider BYOK strings, RevenueCat `rc_credits_*` product identifiers, `api_rate_limits`, and `check_rate_limit(text,integer,integer)` are intentionally retained.

## 2. Validation Evidence

| Validation | Result |
|---|---|
| Focused learning/AI/API-removal Vitest | 38/38 passed |
| Existing sequential-review store Vitest | 9/9 passed |
| Worker customer API removal + sitemap Vitest | 4/4 passed |
| Learning engine SQL integration | `ALL_LEARNING_ENGINE_TESTS_PASSED` |
| AI remediation SQL integration | passed, including access/billing/release/persistence guards |
| Migrations 160–164 local apply | passed in ordered local `psql` chain |
| Web TypeScript | passed |
| Mobile TypeScript | passed |
| Learning core strict TypeScript | passed |
| AI edge Deno check | passed |
| Web production build | passed |
| Worker JavaScript syntax checks | passed |
| Locale JSON/customer-key checks | 32 files across 8 locales passed |
| Active customer API scanner | `ACTIVE_CUSTOMER_API_REFERENCES=0` |
| DB contract check | `api_keys=false`, `resolve_api_key=false`, `internal_rate_limit=true`, `api_rate_limits=true` |
| `git diff --check` | passed |

The web build emits only the existing large main-chunk warning.

## 3. Known Baselines Outside This Change

- Full `packages/shared` typecheck still reports pre-existing DOM/Crypto typing (`CryptoKey`, `AlgorithmIdentifier`, `KeyUsage`), browser `window` references in old shared stores, and old `admin-store` error narrowing. Targeted new-code, web, and mobile checks pass.
- DB lint still reports only the pre-existing ambiguous `id` references in `public.admin_get_reports` and `public.get_deck_versions`; no new learning/remediation function is reported.
- The local Supabase instance is shared by worktrees and was concurrently reset during validation. To avoid stale/interleaved state, final SQL evidence was produced by one uninterrupted cleanup → migrations 160–164 apply → AI test → learning test chain. No remote database was touched.

## 4. External Follow-up

Repository source no longer routes to or advertises `/docs/api`. A previously deployed CDN/Cloudflare asset or cached route can remain reachable until the owning deployment is updated or an explicit redirect/gone response is configured. Deployment and remote content/cache changes are intentionally outside this task.

- Final Git status shows this uncommitted worktree still based on `af38ad8` while the shared `origin/develop` tracking ref advanced by 18 commits during the implementation window. No rebase/merge was attempted because the task forbids commits and did not authorize integration; reconcile against the newer remote before creating a future commit/PR.
