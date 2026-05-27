# Cache Optimization — Phase 4 (card-list LRU cache + admin-store unification)

> Builds on Phase 1 utility (`DOCS/DONE/cache-optimization.md`). Same util, same rigor.
> Closes the two items deferred in Phase 2/3 — now with their required safeguards.

## A. Per-deck card-LIST cache (the previously-deferred risky one)

`card-store.fetchCards(deckId)` refetches a deck's full card list on every open.
Deferred twice because: (1) card lists are large (≤1500/deck) → unbounded data
cache = memory risk; (2) `DeckDetailScreen` filters by `srs_status` and **study
writes SRS bypassing card-store** → naive cache → stale status filter after study.

### Design (safeguards mandatory)
- **Bounded LRU data cache**: `cardsByDeck: Map<deckId, Card[]>` capped at
  `MAX_DECKS` (6); evict least-recently-used on overflow. `cardListCache`
  (Phase-1 `createStaleCache`, 5min) keyed by deckId for freshness.
- `fetchCards(deckId,{force?})`: cache-hit (fresh + present) → serve `cardsByDeck`
  into `cards` with **no network**; else fetch → store (LRU) → `markFetched`.
- **Invalidate on every write path**:
  - all card-store mutations (create/createCards/update/delete/deleteCards/resetSRS)
    → `invalidateCards(deckId)` before the post-mutation refetch.
  - **study-store**: `endSession` (non-cramming) → `useCardStore.getState().invalidateCards(deckId)`
    so the SRS the study session wrote is reflected on next DeckDetail open.
  - `useCards` → fetch on **focus** (not mount) so returning from a study/edit
    flow re-runs `fetchCards` (cache-hit if untouched, refetch if invalidated).
- New action `invalidateCards(deckId?)` (omit → all). Cross-store deps:
  card→deck, study→card; no cycle (deck/study don't import card... study imports card here, card doesn't import study).

## B. admin-store → shared utility (unification, requested)
Replace admin-store's private `_fetchedAt` Record + `isFresh` + `CACHE_TTL` with
`createStaleCache` (8 section keys). Behavior-preserving: `shouldFetch(section)`
gate, `markFetched(section)` on success, `forceRefresh(section)` → `invalidate`.
Removes the last hand-rolled TTL cache → all caching now on one utility.

## Tests (real logic)
- card-store: cache-hit serves without network; force refetches; mutation
  invalidates → refetch; **LRU eviction** (open >6 decks → oldest evicted); a
  study `endSession` invalidates that deck's cache.
- admin-store: keep `admin-store-official.test.ts` green (migrate any `_fetchedAt`
  poking to `forceRefresh`); add fresh/force/forceRefresh case if useful.

## Gates
tsc (mobile+web) 0 · new + existing card/admin tests green · full CI green ·
stores+lib failure count ≤ baseline.
