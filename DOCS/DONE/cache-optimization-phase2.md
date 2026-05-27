# Cache Optimization — Phase 2 (read-heavy fetch reduction)

> Status: ✅ SHIPPED (PR #116→#117). Builds on Phase 1 (`DOCS/DONE/cache-optimization.md` —
> shipped `shared/lib/cache/stale-cache.ts`). Same utility, same rigor.

## Goal
Cut redundant network on **read-heavy, low-mutation** surfaces using the Phase-1
TTL cache utility — i.e. genuine fetch reduction (not just DRY).

## Target chosen: marketplace browse listings

`marketplace-store.fetchListings()` (the public deck catalog) currently refetches
**all active listings on every Marketplace tab visit**. It is the clearest
fetch-reduction win and low-risk:

- Read-heavy: opened/re-opened frequently while browsing.
- Benign staleness: the viewer does not own/edit catalog listings; a few-minute-old
  catalog is acceptable. (Contrast with the user's own decks/cards.)
- Already-known invalidation points: `publishDeck` / `unpublishDeck` change what
  the owner should see → invalidate there. Pull-to-refresh forces.

### Changes
- `shared/stores/marketplace-store.ts` (mobile) **and** `web/src/stores/marketplace-store.ts`
  (dual store — keep in sync): wrap `fetchListings` with `createStaleCache` (ttl 5min),
  add `{ force? }`, `markFetched` on success only, `invalidate` on publish/unpublish.
- Mobile `MarketplaceScreen` pull-to-refresh → `fetchListings({ force: true })`.

### Tests (real logic)
- web: `fetchListings` skips the network within TTL, refetches when forced, and
  refetches after `publishDeck`/`unpublishDeck` invalidation (assert supabase
  `.from('marketplace_listings')` call counts via mock).

## Deliberately DEFERRED (engineering judgment, not omission)

- **Per-deck card-LIST cache** (`card-store`): deferred. Card lists are
  **edit-heavy** (create/import/edit/delete/AI-generate) and **large** (decks up
  to 1500 cards → a multi-deck data cache is a real memory cost). Right after a
  stale-data incident, the risk/reward is poor: the win is only "revisit the same
  deck within 5 min without editing". If pursued later it must be bounded (LRU cap)
  and invalidated on every write path **including study SRS updates** (which bypass
  card-store today). Documented here rather than shipped blind.
- `admin-store` migration to the shared utility: low user impact; cosmetic DRY.

## Verification gates
- `tsc` (mobile + web) clean · new marketplace-cache tests green · full CI green ·
  total stores+lib failure count == baseline (no regression).
