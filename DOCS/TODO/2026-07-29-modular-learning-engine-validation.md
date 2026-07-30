# Modular Learning Engine — Implementation Validation and Audit

**Date:** 2026-07-29, revalidated 2026-07-30 after merging `origin/develop`  
**Branch/worktree:** `feat/modular-learning-engine-foundation` in `modular-learning-engine`  
**Base:** cut from `af38ad8`; merged up to `origin/develop` `97a5399`  
**Scope:** migrations 165, 167–169, shared learning core, planner/evaluators/domain adapters, AI remediation, customer external API removal, web/mobile compatibility.

Atomic study recording is **out of scope**: it converged on develop's `apply_study_rating` contract (migrations 160/161/162) and this branch's competing migration 166 was dropped on merge. See design §8.1.

No commit to a protected branch, no push, no deployment, no remote migration, and no remote data operation was performed. All database evidence below is from the local Supabase instance.

## 1. Zero-Defect Audit

### 1.1 Deep Dive

The initial implementation audit found and corrected:

- ~~rating retries compared only a partial payload; migration 166 stored/compared the full client rating payload and serialized `(user, client_rating_id)` retries with an advisory transaction lock~~ — **withdrawn.** Migration 166 was dropped when this branch merged develop's `apply_study_rating` contract, which enforces the same property through its `study_rating_events` ledger and revision checks. The finding is preserved here only as history;
- attempt retries compared only target/type fields; migration 167 now compares goal/targets, response, score, evaluator result, feedback, hints, duration, and evaluator version, with an advisory lock on `(user, client_attempt_id)`;
- plan-item attempt validation omitted activity/response/evaluator snapshots; all are now checked;
- goal create/unarchive cap checks were not serialized and lifecycle transitions were too loose; per-user advisory locking, a stable transition graph, archived immutability, and unarchive cap enforcement were added;
- plan saves did not explicitly reject empty `reason_code`, out-of-range priority, or non-positive duration and did not normalize JSON `null` payloads; all are now explicit;
- rollback 165 was not safe after a partial migration failure; `ALTER TABLE IF EXISTS` now makes cleanup partial-state safe;
- the pure planner may return a successful empty plan while persistence rejects zero items; design §21.8 now explicitly defines that no-work plans are not persisted.

### 1.2 Double-Check

Concurrency, retries, side effects, and compatibility were rechecked:

- atomic rating writes progress and the study log in one transaction; stale state produces no write — now verified against develop's `apply_study_rating` rather than a function in this branch;
- duplicate SRS and non-SRS ratings return the prior result without another log (develop's contract);
- duplicate attempts do not increment usage or plan aggregates twice (migration 167);
- completed plan items update completion attempt, item state, and plan aggregates atomically;
- the study store awaits persistence before queue advancement and preserves retry IDs; since develop phase 7 there is one shared store, not two, so no cross-copy parity guard is needed;
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

Final checks confirm (re-measured 2026-07-30 against the local database):

- all 13 new functions are `SECURITY DEFINER` with `search_path=public` pinned (13/13);
- all 12 new tables (11 from migration 165 plus `learning_usage_daily` from 167) have RLS enabled (12/12);
- `anon` cannot execute any of the 10 user-facing RPCs, while `authenticated` can (`anon=f, authenticated=t` for all 10);
- the two internal access helpers `_check_card_access` and `_check_activity_access` are executable by none of `anon`/`authenticated`/`service_role`;
- `persist_ai_remediation` is service-only (`anon=f, authenticated=f, service_role=t`);
- no new table grants `INSERT`/`UPDATE`/`DELETE` to `anon` or `authenticated`; `learning_usage_daily` additionally denies `SELECT`;
- `rate_card_and_log` and `insert_study_log` are both absent from the database, confirming the branch adds no second write path and does not resurrect the retired RPC;
- `api_keys` and `resolve_api_key` are absent;
- active customer API references are zero across packages, prototype source, edge functions, worker modules, and worker entrypoint;
- internal app JWT functions, AI-provider BYOK strings, RevenueCat `rc_credits_*` product identifiers, `api_rate_limits`, and `check_rate_limit(text,integer,integer)` are intentionally retained.

## 2. Validation Evidence

Re-run in full on 2026-07-30 after merging `origin/develop` `97a5399`. Every row below is an observed command result, not a carried-forward claim.

| Validation | Result |
|---|---|
| Web Vitest — full suite | 132 files / 2201 tests passed |
| Worker Vitest (incl. customer API removal) | 17 files / 126 tests passed |
| Integration Vitest vs local Supabase | 5 files / 48 tests passed |
| — `study-persistence.spec.ts` (develop's rating contract) | 17 passed |
| — `study-write-contract.spec.ts` | 11 passed |
| Learning engine SQL integration | `ALL_LEARNING_ENGINE_TESTS_PASSED`, exit 0 |
| AI remediation SQL integration | exit 0 (9 `ASSERT`s + 4 raise-guards) |
| Learning engine **smoke** SQL | `ALL_LEARNING_SMOKE_TESTS_PASSED`, 9/9 steps |
| Learning engine **net-zero** SQL | `ALL_LEARNING_NET_ZERO_TESTS_PASSED`, 37 rejection cases + quota integrity |
| Learning migration **dry run** | `LEARNING_DRY_RUN_PASSED` — 0 → 12 tables/13 fns → 0 residue → idempotent re-revert → restored |
| SQL harness negative controls | bad assert → exit 1; `before` phase on an applied DB → exit 1; unexpected success → flagged |
| Migrations 165/167/168/169 local apply | each exit 0, applied in order on top of develop's 160/161/162 |
| Web TypeScript (`tsconfig.app.json`) | passed |
| Mobile TypeScript | passed |
| Learning core TypeScript | 0 errors under `packages/shared/learning/` |
| Web production build | passed |
| Architecture guard | `domain layer is clean, study logic is single-source` |
| Rebuilt `dist` stale-reference scan | 0 hits for `rate_card_and_log`; bundle calls `apply_study_rating` |

The web build emits only the existing large main-chunk warning.

Migration NOTICEs during 168/169 apply (`ai_generation_jobs_job_kind_check ... skipping`, `resolve_api_key ... skipping`, `api_keys ... skipping`) are the intended `IF EXISTS` idempotence on an instance where those objects are already absent.

## 3. Known Baselines Outside This Change

- **CI registration gap found and fixed.** `.github/workflows/ci.yml` lists SQL suites explicitly (the file itself warns that "a new suite is invisible to CI until it is added here"). `learning_engine_test.sql` and `ai_remediation_test.sql` shipped with this branch but were never registered, so they had only ever been run by hand. Both are now wired into the `ai-credit-tests` job together with the new smoke, net-zero, and dry-run suites.
- Full `packages/shared` typecheck reports 18 errors: DOM/Crypto typing (`CryptoKey`, `AlgorithmIdentifier`, `KeyUsage`, `Crypto`), browser `window` references in old shared stores, and old `admin-store` error narrowing. All 18 sit in six files — `adapters/crypto.ts`, `lib/ai/secure-storage/crypto/aes-gcm-crypto.ts`, `lib/persistence-id.ts`, `stores/admin-store.ts`, `stores/auth-store.ts`, `stores/subscription-store.ts` — and every one of those files is byte-identical to `origin/develop`, so this branch introduces zero new type errors. `packages/shared/learning/` reports 0 errors. (`lib/persistence-id.ts` arrived from develop commit `b6247e0`.)
- DB lint still reports only the pre-existing ambiguous `id` references in `public.admin_get_reports` and `public.get_deck_versions`; no new learning/remediation function is reported.
- `tests/integration/vitest.config.ts` sets `include: ['**/*.spec.ts']` without a `root`, so invoking it from the repository root also collects `packages/mobile/__tests__/e2e/**` WebdriverIO specs, which fail with `describe is not defined`. The file is byte-identical to `origin/develop`, so this is a pre-existing config defect, not a regression here. Passing an explicit `tests/integration` path scopes the run correctly.
- The local Supabase instance is shared by worktrees. The 2026-07-30 evidence was produced against an instance already holding develop's migrations 160/161/162 and none of this branch's, then applying 165 → 167 → 168 → 169 in one uninterrupted ordered chain. No remote database was touched.

## 4. External Follow-up

Repository source no longer routes to or advertises `/docs/api`. A previously deployed CDN/Cloudflare asset or cached route can remain reachable until the owning deployment is updated or an explicit redirect/gone response is configured. Deployment and remote content/cache changes are intentionally outside this task.

- Remote reconciliation is **done**: the worktree was merged up to `origin/develop` `97a5399` (merge `40c0047`), which brought study phases 6–7, the full web Vitest gate, and the hardening lockdown. The only conflict was `packages/web/src/lib/__tests__/guide-content.test.ts`, resolved to develop's generalized link-contract guard.
- Because develop phase 7 (PR #343) deleted `packages/web/src/stores/study-store.ts` and web's duplicate `srs`/`study-queue`/`cramming-queue`/`study-session-utils` libs, design §5.3's "accepted duplicate" exception and §19's deferred store-unification item no longer apply and are marked resolved.
- A stale untracked `scripts/runtime-web-check.ts` targeting the removed `rate_card_and_log` RPC and `client_rating_payload` column was deleted; develop's `study-persistence.spec.ts` and `study-write-contract.spec.ts` cover the same properties against the surviving contract.
- Still outstanding before a PR: nothing functional is known open. Production migration, deployment, and any remote data operation remain explicitly out of scope and require owner authorization.
