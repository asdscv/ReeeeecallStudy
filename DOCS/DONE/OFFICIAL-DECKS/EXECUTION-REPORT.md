# Official Decks Import — Execution Report

> Date: 2026-05-19
> Worktree: `.claude/worktrees/official-decks-import` (branch `worktree-official-decks-import`)
> Status: ✅ Complete — 327 official decks imported and verified against local DB.

---

## Outcome

- **327 official decks** (322 EN-source × 7 target languages + 5 KO-source → EN)
- **192,548 cards** total across all decks
- **327 active marketplace_listings** owned by the system official account
- All decks have `share_mode = 'subscribe'`, so subscribers see live updates via existing RLS policies.
- `chinese-pronunciation.csv` correctly excluded (zero manifest entries).
- toefl-120-1500.csv (just completed by user) picked up automatically with full 1500 cards × 7 targets.
- Re-running `apply` against unchanged CSVs is a **complete no-op** (all 327 manifests → `noop`).

## Language pair distribution (verified in DB)

| source → target | decks |
|---|---|
| en → ko, ja, zh, es, vi, th, id | 46 each (322 total) |
| ko → en | 5 |

## Category distribution

| category | decks | cards |
|---|---|---|
| beginner | 77 | 28,077 |
| intermediate | 70 | 14,000 |
| advanced | 70 | 7,000 |
| ielts | 35 | 42,000 |
| toefl | 35 | 44,870 |
| toeic | 35 | 47,600 |
| conversation | 5 | 9,001 |

## Test results

| Layer | Tests | Status |
|---|---|---|
| Unit (domain + application + infrastructure) | 99 | ✅ |
| Integration (pg-direct, real DB) | 9 | ✅ |
| Skipped (supabase-js variant, requires postgrest) | 7 | ⏭️ |
| **Total** | **108 pass / 7 skip / 0 fail** | ✅ |

TypeScript: `pnpm typecheck` passes with **strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes**.

## Idempotency proof

```
1st apply: applied=327, noop=0,  failed=0,  time=85s
2nd apply: applied=0,   noop=327, failed=0,  time=10s
validate : drift=0, missing=0, orphan=0
```

## Architecture highlights

1. **Clean architecture** — domain has zero infra dependencies (no `@supabase/supabase-js`, no `fs`, no `papaparse`). Verified by inspection of `src/domain/`.
2. **Deterministic UUIDs** — `deck.id = uuidv5(NAMESPACE_DECK, manifest_key)` matches PostgreSQL's `uuid_generate_v5` 1:1 (locked-in integration test).
3. **Atomic, idempotent RPC** — `import_official_deck` is a single transaction; checksum match → noop; payload diff → insert/update/delete with granular counts.
4. **Diff-aware updates** — `cards_updated` reflects rows whose `field_values`/`tags`/`sort_position` actually changed, not every row touched by the upsert. Verified by integration test (3-row edit → 1 update).
5. **Schema A/B/C auto-detection** — three CSV shapes recognised by the detector; malformed-quote rows in `toefl-110-1500.csv` are recovered automatically by quote-free re-parsing.
6. **Two gateway implementations** sharing one port:
   - `SupabaseDeckImportGateway` for production (HTTP RPC via PostgREST)
   - `PgDeckImportGateway` for tests and local-dev (direct `pg` driver)

## CI/CD

`.github/workflows/official-decks.yml` provides:
- lint-typecheck (strict gate)
- unit (vitest)
- plan-validation (asserts plan count == 327 + every required lang pair exists)
- migration-smoke (applies all migrations against postgres:15, then calls `import_official_deck`)
- integration (full pg suite against postgres-15 service container)
- apply-staging (manual workflow_dispatch only)

Bootstrap script `.github/scripts/bootstrap-auth.sql` recreates the minimal Supabase auth+storage schema CI postgres needs so the existing 001..082 migrations apply unchanged.

## Files added/changed

```
DOCS/OFFICIAL-DECKS/
├── IMPLEMENTATION-PLAN.md
├── ADR-001-clean-architecture-cli.md
├── ADR-002-identity-and-idempotency.md
└── EXECUTION-REPORT.md      ← this file

supabase/migrations/
├── 082_official_decks_system.sql
└── 082_official_decks_system.down.sql

.github/
├── workflows/official-decks.yml
└── scripts/bootstrap-auth.sql

packages/official-decks/                ← new pnpm workspace package
├── src/
│   ├── domain/{value-objects,entities,errors,services}/   12 files
│   ├── application/{ports,services,use-cases,dto}/         9 files
│   ├── infrastructure/{persistence,csv,auth,logging}/      5 files
│   └── presentation/cli.ts
├── __tests__/
│   ├── unit/                                              13 files
│   └── integration/                                        2 files
├── package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts
└── pnpm-lock.yaml (root, updated)
```

## Decision points (recorded for future ops)

| Decision | Why |
|---|---|
| Standalone CLI package vs SQL seeds or Worker | TDD-friendly, decoupled from web/worker release cycle, supports dry-run |
| UUIDv5 deck IDs from manifest_key | Idempotent without composite keys; addressable from anywhere without DB lookup |
| `share_mode = 'subscribe'` (not 'copy') | Live propagation of CSV updates to all subscribers; matches user's "you decide" directive |
| One universal Word template + one Phrase template | All bilingual word decks share field shape; conversation decks need extra fields (alt, situation, note) |
| Quote-free CSV fallback parsing | The corpus contains malformed-quote rows (`toefl-110-1500.csv`); RFC-strict parsing alone would have dropped ~half the data |
