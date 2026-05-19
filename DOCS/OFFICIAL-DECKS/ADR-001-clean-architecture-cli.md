# ADR-001: Standalone CLI Package with Clean Architecture for Official Deck Imports

- **Status:** Accepted
- **Date:** 2026-05-19
- **Deciders:** Platform / Content (project owner Luke)

## Context

We need to import 327 multilingual official decks from 51 source CSVs into the production DB, with strong guarantees: idempotency, atomicity, auditability, and the ability to re-run after CSV edits without producing duplicates. The system must also be testable end-to-end with Docker + TDD, and integrated into CI/CD.

Three high-level options exist:

1. **Supabase SQL seed scripts** — embed the CSV data into `INSERT` statements and rely on migration ordering.
2. **Cloudflare Worker job** — extend the existing `worker-modules/` daily cron to also handle CSV imports.
3. **Standalone Node.js CLI package** — a new `packages/official-decks/` workspace member that talks to Supabase via service-role.

## Decision

Adopt **Option 3** — standalone CLI package with Clean Architecture layering.

## Consequences

### Why not SQL seed scripts?

- 34,000+ row CSV → ~30 MB of SQL DDL, slow to apply, slow to review.
- Re-running edits requires hand-written diff scripts; no idempotency for free.
- No streaming, no checksum, no manifest.
- Can't run a dry-run to preview changes.

### Why not the Cloudflare Worker?

- Workers have CPU/memory/time limits unsuited for batch imports (~327 deck × ~average 1000 cards).
- The daily worker is for *generating* content, not for importing static CSVs. Conflating responsibilities couples release cycles.
- TDD is harder — workers don't run vitest natively without `@cloudflare/vitest-pool-workers`, which adds friction.

### Why a standalone CLI

- **Layering** — Clean Architecture (domain / application / infrastructure / presentation) makes the import logic testable without Supabase, then independently testable *with* Supabase via Docker.
- **Reproducibility** — a CLI run is a single audited command, logs to manifest, exits with a status code CI can gate on.
- **Reuse** — same pipeline runs locally, on a contributor's laptop, in staging CI, and in production via `workflow_dispatch`.
- **TDD-friendly** — vitest runs the same way at every level; domain has zero external deps.
- **Decoupled deployment** — bug fixes to the importer don't redeploy the worker or web app.

## Trade-offs Accepted

- Adds a new workspace package (extra surface area, but pnpm workspaces already supports it cleanly).
- The CLI must be invoked manually or via GH Actions (no in-app trigger). This is desired — we don't want end users running batch imports.
- Service-role key handling requires care; we never check it into the repo, only inject via env in CI secrets.

## Implementation Notes

- Domain layer **must** have zero imports from `@supabase/supabase-js`, `papaparse`, `fs`, etc. Enforced by `eslint-plugin-import` zone restriction.
- Adapters in `infrastructure/` implement ports from `application/`. The wiring (composition root) lives in `presentation/cli.ts`.
- All writes go through one RPC: `import_official_deck`. No raw `INSERT` calls from the CLI.
- The CLI never holds the service-role key in process longer than necessary; it's read from env on startup.
