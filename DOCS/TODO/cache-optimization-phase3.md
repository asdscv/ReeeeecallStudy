# Cache Optimization — Phase 3 (official-store read caching)

> Builds on Phase 1 utility (`DOCS/DONE/cache-optimization.md`). Same util, same rigor.

## Target: official-store reads (web)
`official-store` (shared; consumed by **web** MarketplacePage + AdminOfficialPage —
no longer by mobile) has **no TTL cache**: `fetchOfficialListings` /
`fetchOfficialAccounts` refetch on every page mount. Read-only, admin-curated
data → benign staleness → safe TTL cache = real web fetch reduction.

### Changes
- `shared/stores/official-store.ts`: `createStaleCache` (5min) keyed `accounts` /
  `listings`. `fetch*` gain `{ force? }`, gate on `shouldFetch`, `markFetched` on
  success only. **Admin mutations** (`setOfficialStatus`, `updateOfficialSettings`)
  `invalidate('accounts')` + `invalidate('listings')` before their refresh so the
  change is visible immediately (and the catalog's official badges refresh).
- `reset()` also clears the cache (state + freshness) — keeps test isolation honest.

### Tests
- Extend `official-accounts.test.ts` beforeEach → `reset()` (clears cache between
  tests). New cases: skip within TTL, force refetch, admin mutation forces refresh.

## Decisions / deferrals (objective self-assessment)
- **card-LIST cache: still deferred.** Confirmed `DeckDetailScreen` filters cards by
  `srs_status`, and study (`study-store`) writes SRS **bypassing card-store** → a
  cached card list would show a stale status filter after studying. Correct fix
  needs study→card invalidation + bounded LRU; risk/reward still unfavorable.
- **admin-store migration: deferred (not busywork).** It already has a working
  private TTL cache (8 section keys + forceRefresh). Migrating purely for DRY adds
  admin-dashboard regression risk with zero user-facing gain → skipped per the
  "no test/refactor for its own sake" rule. Documented, not done.

## Gates
tsc (mobile+web) 0 · official-store tests green · full CI green · stores+lib failure
count ≤ baseline.
