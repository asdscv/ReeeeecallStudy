# Official Decks Import System — Implementation Plan

> Status: Active
> Owner: Platform / Content
> Worktree: `worktree-official-decks-import`
> Target: ship 327 multilingual official decks via idempotent, repeatable pipeline.

---

## 1. Problem & Scope

Ship official, system-owned decks generated from `STUDY_DATA/*.csv` to power the marketplace with curated multilingual study content. The pipeline must be:

- **Idempotent** — every CSV row maps to a stable `(deck_id, card_id)` so re-runs upsert in place, never duplicate.
- **Resumable** — partial failures (network, RLS) leave the system in a consistent state.
- **Auditable** — every import writes a manifest row recording source file, row count, checksum, status.
- **Multilingual** — one CSV → up to 7 language-pair decks, each with its own marketplace listing.
- **Decoupled** — runs out-of-band of the web/mobile apps via a dedicated CLI package.

### Inputs (51 CSVs)

| Group | Files | Schema | Rows | Notes |
|---|---|---|---|---|
| Beginner batches | `beginner_batch{1..10}.csv` | A (8-col, no header) | 300 each | 3000 rows |
| Intermediate batches | `intermediate_batch{1..10}.csv` | A (8-col, no header) | 200 each | 2000 rows |
| Advanced batches | `advanced_batch{1..10}.csv` | A (8-col, no header) | 100 each | 1000 rows |
| English beginner | `english-beginner-1000.csv` | B (16-col, header) | 1000 | |
| IELTS | `ielts-{5.0..7.0}-*.csv` | B (16-col, header) | 800..1500 | 5 levels |
| TOEFL | `toefl-{60..120}-*.csv` | B (16-col, header) | 276..1500 | 5 levels |
| TOEIC | `toeic-{600..990}-*.csv` | B (16-col, header) | 1000..1500 | 5 levels |
| Real conversation | `real-conversation-{시사,여행,일상,학습,회사}.csv` | C (6-col, header, KO-source) | 1500..3000 | 5 categories |
| **Excluded** | `chinese-pronunciation.csv` | — | — | Per user decision |

**Schema A** (no header): `en_word, en_ex, ko_word, ko_ex, ja_word, ja_ex, zh_word, zh_ex, es_word, es_ex, vi_word, vi_ex, th_word, th_ex, id_word, id_ex`

**Schema B** (header `english,example,ko_meaning,ko_example,...`): same column meaning as A but with explicit header.

**Schema C** (real-conversation): `korean, english, alt, situation, note, category` — KO source, EN target only.

### Output (327 decks total)

For Schema A+B (46 files × 7 target languages): **322 decks** — `en` source, target ∈ `{ko, ja, zh, es, vi, th, id}`.
For Schema C (5 files × 1 target): **5 decks** — `ko` source, `en` target.

Each deck:
- Owned by system official account `official@reeeeecallstudy.local`
- Backed by canonical card template ("Official Bilingual Word" or "Official Bilingual Phrase")
- Published to `marketplace_listings` with `share_mode='subscribe'` so consumers stay synced with edits
- Tagged with `lang:{source}-{target}`, `category:{beginner|toefl|...}`, `level:{...}` for discoverability

---

## 2. Architecture

### 2.1 Clean Architecture Layers

```
packages/official-decks/
├── src/
│   ├── domain/              # Entities, value objects, domain services — zero infra deps
│   │   ├── value-objects/
│   │   │   ├── LanguageCode.ts       # Branded type: 'en'|'ko'|'ja'|'zh'|'es'|'vi'|'th'|'id'
│   │   │   ├── LanguagePair.ts       # {source, target}, source ≠ target invariant
│   │   │   ├── DeckCategory.ts       # 'beginner'|'intermediate'|'advanced'|'ielts'|'toefl'|'toeic'|'conversation'|'general'
│   │   │   ├── ManifestKey.ts        # Stable identity: csv:{filename}:{src}-{tgt}
│   │   │   ├── Checksum.ts           # SHA-256 of canonicalised CSV content
│   │   │   └── CardFieldValues.ts    # Discriminated union for Word vs Phrase
│   │   ├── entities/
│   │   │   ├── OfficialDeck.ts
│   │   │   └── OfficialCard.ts
│   │   ├── errors/
│   │   │   └── DomainError.ts        # Typed error hierarchy
│   │   └── services/
│   │       ├── DeckMetadataBuilder.ts  # title/description/tags from filename
│   │       ├── CardIdentityService.ts  # UUIDv5 from (deck_manifest_key, row_index)
│   │       └── DeckIdentityService.ts  # UUIDv5 from manifest_key
│   │
│   ├── application/         # Use cases, orchestration — depends on domain only
│   │   ├── ports/
│   │   │   ├── DeckRepository.ts     # interface
│   │   │   ├── CardRepository.ts
│   │   │   ├── ManifestRepository.ts
│   │   │   ├── MarketplaceGateway.ts
│   │   │   └── CsvSource.ts
│   │   ├── services/
│   │   │   ├── CsvSchemaDetector.ts
│   │   │   ├── CsvRowParser.ts
│   │   │   └── ImportPlanBuilder.ts
│   │   ├── use-cases/
│   │   │   ├── PlanImportUseCase.ts        # Pure: CSV → ImportPlan (no I/O)
│   │   │   ├── ExecuteImportUseCase.ts     # Orchestrates upserts
│   │   │   ├── DryRunImportUseCase.ts      # Reports diff without writing
│   │   │   └── ValidateManifestUseCase.ts  # Audit: DB matches CSV checksum
│   │   └── dto/
│   │       ├── ImportPlan.ts
│   │       └── ImportReport.ts
│   │
│   ├── infrastructure/      # External adapters
│   │   ├── persistence/
│   │   │   ├── SupabaseDeckRepository.ts
│   │   │   ├── SupabaseCardRepository.ts
│   │   │   ├── SupabaseManifestRepository.ts
│   │   │   └── SupabaseMarketplaceGateway.ts
│   │   ├── csv/
│   │   │   ├── PapaCsvSource.ts            # papaparse-based streaming
│   │   │   └── schemas/
│   │   │       ├── SchemaA.ts              # batches
│   │   │       ├── SchemaB.ts              # exam + beginner-1000
│   │   │       └── SchemaC.ts              # real-conversation
│   │   ├── auth/
│   │   │   └── ServiceRoleClient.ts        # Supabase service_role client factory
│   │   └── logging/
│   │       └── PinoLogger.ts
│   │
│   └── presentation/        # CLI entry points
│       ├── cli.ts                          # main, sub-commands
│       └── commands/
│           ├── plan.ts                     # `official-decks plan`
│           ├── apply.ts                    # `official-decks apply`
│           ├── status.ts                   # `official-decks status`
│           └── validate.ts                 # `official-decks validate`
│
├── __tests__/
│   ├── unit/                # domain + application (no I/O)
│   ├── integration/         # against docker postgres + supabase
│   └── e2e/                 # full CLI invocation
│
├── config/
│   ├── languages.json       # supported targets per source
│   ├── csv-schemas.json     # file→schema mapping
│   └── deck-categories.json
│
├── Dockerfile               # build the CLI as a container image
├── docker-compose.test.yml  # supabase-local + test runner
└── package.json
```

### 2.2 Dependency Direction

```
presentation → application → domain
infrastructure → application (implements ports)
infrastructure → domain (uses entities/value objects)
domain → ∅  (pure)
```

All adapters in `infrastructure/` implement ports declared in `application/ports/`. The DI wiring lives in `presentation/cli.ts`. Domain has zero runtime dependencies (no Supabase, no papaparse imports).

### 2.3 Identity Strategy

| Resource | Identity Source | Why |
|---|---|---|
| `decks.id` | `uuidv5(NAMESPACE_DECK, manifest_key)` | Stable across reruns; manifest_key = `csv:beginner_batch1:en-ko` |
| `cards.id` | `uuidv5(NAMESPACE_CARD, `${deck_id}:${row_index}`)` | Re-import same row → same card UUID |
| `card_templates.id` | Fixed UUID constants for word/phrase templates | Two universal templates, never duplicated |
| `marketplace_listings.id` | DB default (random) | One listing per deck, UNIQUE on `deck_id` enforces 1:1 |
| `official_deck_manifest.id` | DB default | Audit log row, not addressable |
| System user `auth.users.id` | Fixed UUID `00000000-0000-0000-0000-000000000001` | Migration-seeded |

`NAMESPACE_DECK` / `NAMESPACE_CARD` are two app-specific UUIDv5 namespaces baked into the code (`packages/official-decks/src/domain/services/DeckIdentityService.ts`).

### 2.4 Atomicity & Idempotency

Every import operates per-deck (one deck = one transaction):
1. Compute `manifest_key` from CSV filename + language pair.
2. Compute `csv_checksum` (SHA-256 of canonicalised rows — same content always → same hash).
3. Call RPC `import_official_deck(p_manifest_key, p_checksum, p_metadata, p_cards jsonb[])`:
   - SECURITY DEFINER (bypasses RLS, runs as system).
   - Verifies caller is the system user (or admin role).
   - Upserts `decks` row with deterministic id.
   - Diff-applies cards: insert missing, update changed, soft-delete removed (rows in DB but not in payload).
   - Upserts `marketplace_listings` row (card_count, tags refresh).
   - Records `official_deck_manifest` row with status + checksum + timing.
4. On error, the entire RPC transaction rolls back; manifest row records `status='failed'` after rollback via a follow-up insert.

Re-running with unchanged CSV is a no-op (checksum matches `official_deck_manifest.last_applied_checksum`).

### 2.5 Sharing Model

`share_mode = 'subscribe'` is chosen because:
- The user explicitly chose "fully publish, you decide" — subscribe = live updates, which is the higher-value default for curated content.
- Edits to official decks propagate to all subscribers instantly via existing RLS policy `"Subscribers read shared cards"` (009 migration line 113-122).
- `user_card_progress` already isolates each subscriber's SRS state from card content — verified safe.

Marketplace listing is created with `is_active = true` immediately. Discoverability is governed by the existing `get_official_listings` RPC (061).

---

## 3. Database Migration `082_official_decks_system.sql`

### 3.1 New Objects

```sql
-- System user seed
INSERT INTO auth.users (id, ...) VALUES ('00000000-0000-0000-0000-000000000001', ...);
INSERT INTO profiles (id, display_name, role, is_official) VALUES (
  '00000000-0000-0000-0000-000000000001', 'ReeeeecallStudy Official', 'user', true
);
INSERT INTO official_account_settings (user_id, display_badge, organization_name, featured_priority, max_listings)
  VALUES ('00000000-0000-0000-0000-000000000001', 'official', 'ReeeeecallStudy', 100, 1000);

-- Two universal card templates (fixed UUIDs)
INSERT INTO card_templates (id, user_id, name, fields, ...) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Official Bilingual Word', ...),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Official Bilingual Phrase', ...);

-- Manifest
CREATE TABLE official_deck_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_key TEXT UNIQUE NOT NULL,          -- csv:beginner_batch1:en-ko
  deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,                  -- beginner_batch1.csv
  source_language TEXT NOT NULL,              -- en
  target_language TEXT NOT NULL,              -- ko
  category TEXT NOT NULL,                     -- beginner
  card_count INTEGER NOT NULL DEFAULT 0,
  last_applied_checksum TEXT,
  last_applied_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'pending' CHECK (last_status IN ('pending','applied','failed','noop')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_odm_status ON official_deck_manifest(last_status);
CREATE INDEX idx_odm_category ON official_deck_manifest(category);

-- Atomic upsert RPC
CREATE FUNCTION import_official_deck(
  p_manifest_key   TEXT,
  p_checksum       TEXT,
  p_deck           JSONB,   -- {id, name, description, color, icon, template_id, category, tags, source_file, source_language, target_language}
  p_cards          JSONB    -- array of {id, sort_position, field_values, tags}
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ ... $$;
```

The RPC:
1. Validates caller is system user OR admin.
2. Short-circuits to `noop` if checksum matches `last_applied_checksum` (still updates `last_applied_at`).
3. `INSERT ... ON CONFLICT (id) DO UPDATE` for the deck.
4. Diff-applies cards: compares incoming card ids with existing, inserts new, updates changed `field_values`/`tags`/`sort_position`, deletes rows whose ids are no longer in the payload.
5. Refreshes `marketplace_listings` (upsert by `deck_id`).
6. Writes `official_deck_manifest` row with `last_status='applied'`.
7. Returns summary `{deck_id, cards_inserted, cards_updated, cards_deleted, status}`.

### 3.2 RLS Considerations

- All writes go through SECURITY DEFINER RPC — no direct INSERT/UPDATE from CLI.
- System user has no special RLS policies; the RPC bypasses RLS by virtue of `SECURITY DEFINER` + `SET search_path = public`.
- `prevent_official_escalation` trigger (039) does not fire because we never `UPDATE profiles.is_official` after the initial migration insert.

### 3.3 Down Migration

Provided in `082_official_decks_system.down.sql`:
1. Delete marketplace_listings owned by system user.
2. Delete decks owned by system user (cascades to cards).
3. Delete official_deck_manifest table.
4. Drop import_official_deck function.
5. Delete card_templates with fixed UUIDs.
6. Delete official_account_settings, profile, auth.users row for system user.

---

## 4. TDD Strategy

**Rule: every PR adds tests that prove the bug or capability is gone/present. No tests written to satisfy coverage targets — only tests that solve real problems.**

### 4.1 Unit Tests (Vitest, no I/O)

- **Value objects**: branded type guards, invariants (LanguagePair source≠target), parsing edge cases (empty fields, BOM, CRLF).
- **DeckMetadataBuilder**: filename `beginner_batch1.csv` → title `"Beginner Vocabulary Batch 1"`, category `beginner`, level tag.
- **CsvSchemaDetector**: 3 schemas distinguished correctly; unknown schemas throw `UnknownSchemaError`.
- **CsvRowParser**: malformed rows (wrong column count, missing required field) raise `MalformedRowError` with row index.
- **CardIdentityService**: same input → same UUID; different deck or index → different UUID.
- **ImportPlanBuilder**: given a CSV path + manifest_key, produces deterministic `ImportPlan` with N cards.

### 4.2 Integration Tests (Docker postgres)

`docker-compose.test.yml` brings up:
- `postgres:15` with `supabase/migrations/*.sql` auto-applied via init scripts
- `postgrest` for RPC HTTP endpoint
- Test runner container

Tests verify:
- `import_official_deck` upserts atomically.
- Re-running with same checksum → `noop`, no card changes.
- Re-running with modified CSV → updates only changed cards.
- Deleting cards from CSV → diff removes them from DB.
- Non-system, non-admin caller → RPC raises `permission denied`.
- Subscriber's `user_card_progress` is unaffected by deck content updates.

### 4.3 E2E Tests

- Run CLI `apply --dry-run` against fixture CSV → exit 0, prints plan, no DB writes.
- Run CLI `apply` against fixture → DB matches expected snapshot.
- Run CLI `apply` twice → second run is no-op.
- Modify one card in fixture → `apply` updates only that card; manifest checksum changes.

---

## 5. CI/CD (.github/workflows/official-decks.yml)

```yaml
name: Official Decks Pipeline

on:
  pull_request:
    paths:
      - 'packages/official-decks/**'
      - 'STUDY_DATA/**'
      - 'supabase/migrations/082_*.sql'
      - '.github/workflows/official-decks.yml'
  push:
    branches: [main]
    paths: <same>

jobs:
  lint-typecheck:
    # strict: tsc --noEmit, eslint --max-warnings 0

  unit:
    # vitest run unit/ with coverage gate (≥95% domain, ≥90% application)

  integration:
    services:
      postgres: postgres:15
    # apply all migrations, run integration/ suite

  dry-run-validation:
    # Spin up local supabase, run `official-decks plan` against all 51 CSVs
    # Asserts: exactly 327 deck plans produced, no parse errors, checksums stable

  csv-checksum-drift:
    # Computes checksums of STUDY_DATA/*.csv, compares against committed snapshot
    # Fails if CSV changed without manifest snapshot update (forces awareness)

  docker-build:
    # Build & push container image to GHCR on main

  apply-staging:
    # On main push: run `official-decks apply --env staging --yes`
    # Records manifest, posts summary to PR/commit

  approval-gate:
    # Manual `workflow_dispatch` for production apply
```

Hook into existing `ci.yml` jobs so the main CI still runs unchanged for unrelated PRs (path-filtered).

---

## 6. Execution Phases (mapped to TaskList)

| Phase | Output | Tests |
|---|---|---|
| 0 | Plan doc (this file) + ADRs | n/a |
| 1 | Migration 082 + tests | SQL pgTAP-style assertions (or vitest against pg) |
| 2 | Domain package, value objects, services | Unit (vitest) |
| 3 | Application use cases | Unit (vitest) |
| 4 | Infrastructure adapters | Integration (docker) |
| 5 | CLI commands | E2E (spawn) |
| 6 | Real import run | Manifest validation queries |
| 7 | CI workflow + Dockerfile | Workflow lint via `act` if installed; otherwise dry-run via push |
| 8 | Gap audit loop | Re-run all phases' tests + manual review |

---

## 7. Assumptions & Risks

| Assumption | Risk | Mitigation |
|---|---|---|
| CSV files are stable on disk | A CSV gets edited mid-import | Checksum check + atomic per-deck transaction; partial progress is fine because subsequent decks just continue |
| 8 languages cover all targets | A future CSV adds a 9th language column | Schema detector throws `UnknownSchemaError` — fail loud, not silent |
| 327 decks is acceptable count for marketplace | UI doesn't paginate well | `get_official_listings` already accepts `p_limit`; UI uses existing pagination |
| System user can hold 1000 marketplace listings | `max_listings = 100` default in 061 | Migration 082 explicitly sets `max_listings = 1000` for system user |
| All CSVs use UTF-8 | Some may be UTF-8-BOM or non-UTF-8 | papaparse handles BOM; we add a guard test for known files |
| `next_position` on decks doesn't conflict | Two parallel CLI runs collide | CLI is single-process; serialise per `manifest_key` |
| The 327 number is correct | Off-by-one in counting | Plan job in CI emits exact count; gates merge on `== 327` |

---

## 8. Success Criteria (Definition of Done)

- All migrations apply cleanly from `001` through `082` on a fresh DB.
- `pnpm --filter @reeeeecall/official-decks test` passes (unit + integration + e2e).
- `official-decks plan` emits **exactly 327** deck plans across the 51 input CSVs.
- `official-decks apply` succeeds in dry-run and live modes against local Supabase.
- Re-running `apply` immediately after a successful run reports `0 changes` (all rows `noop`).
- A modified CSV row, when re-applied, causes **only** the affected card to update — verified by diffing `cards.updated_at` timestamps.
- Marketplace API (`get_official_listings`) returns 327 active listings owned by the system user.
- Subscriber flow: a test user calls `copy_deck_for_user(p_share_mode='subscribe')` → reads cards → ends up with the system deck visible in their `useDeckStore`. Updating a card on the system deck is immediately visible to the subscriber on next fetch.
- `.github/workflows/official-decks.yml` passes on a clean PR.
- Zero `any` types in `packages/official-decks/src/domain/**` (strictest TS settings for domain).
- Coverage: ≥95% statements on `domain/`, ≥90% on `application/`, ≥80% on `infrastructure/`.

---

## 9. Out of Scope (this PR)

- UI changes for the marketplace (existing UI already lists official decks via `get_official_listings`).
- Auto-translation for missing languages — we rely on existing CSV content only.
- Periodic re-import scheduling (cron) — manual `workflow_dispatch` only for now.
- Multi-tenant / per-region official deck variants.
- A/B testing of deck variants.
- Migration of `chinese-pronunciation.csv` — explicitly excluded by user.
