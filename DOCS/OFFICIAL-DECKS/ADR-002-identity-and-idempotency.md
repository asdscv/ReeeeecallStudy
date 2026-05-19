# ADR-002: Identity & Idempotency Strategy

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

Re-running the import must never duplicate decks or cards. We need stable, deterministic identifiers so that the second run upserts in place.

## Decision

**Deterministic UUIDv5 derived from a `manifest_key`.**

- `manifest_key` = `csv:{filename}:{source_lang}-{target_lang}` (e.g. `csv:beginner_batch1:en-ko`).
- Two app-specific namespace UUIDs are baked into the code (one for decks, one for cards):
  - `NAMESPACE_DECK = '6f7d8a9b-3c4e-5d6f-7a8b-9c0d1e2f3a4b'`
  - `NAMESPACE_CARD = '7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b'`
- `deck.id = uuidv5(NAMESPACE_DECK, manifest_key)`
- `card.id = uuidv5(NAMESPACE_CARD, `${deck.id}:${row_index}`)`

## Consequences

- Re-importing the same CSV under the same name produces identical IDs → simple `INSERT ... ON CONFLICT (id) DO UPDATE`.
- Renaming a CSV file or changing the language pair produces new IDs → new decks. This is desired: a renamed source is conceptually a new deck.
- Reordering rows in a CSV produces different `card.id` (because `row_index` changes). To avoid spurious deletes/inserts on benign reorders, we sort rows by their content-derived key (front-text + back-text hash) before computing row_index. Locking content-order in source-of-truth is a non-goal; we just want stable behaviour.

## Checksum

Beyond IDs, we also track a `csv_checksum`:
- `SHA-256` over the canonicalised CSV (rows sorted by content key, fields trimmed, blank rows stripped).
- Stored in `official_deck_manifest.last_applied_checksum`.
- The RPC short-circuits to `noop` if the checksum matches → zero DB writes for unchanged inputs.

## Why not auto-increment / random UUIDs

- Random UUIDs are not idempotent. Reruns need either a unique key (composite of source_file + lang_pair + row_index) or deterministic UUIDs. We choose deterministic UUIDs because:
  - They are addressable: anyone can recompute `card.id` from `(manifest_key, row_index)` without querying the DB.
  - They make audit logs human-traceable (manifest_key → deck → card).
  - They avoid a composite unique index that would need to be added to `cards` table (intrusive schema change).

## Edge Cases

- A row's `front` text changes but its position stays → updates `field_values`, same `card.id`. ✓
- A row is deleted → its `card.id` is missing from the payload → RPC deletes it. ✓
- A row is added → new `card.id`, gets inserted. ✓
- A row is moved → `row_index` changes → looks like delete-then-insert. **Mitigation**: sort rows by content-derived key during canonicalisation so position is content-driven, not file-position-driven.
