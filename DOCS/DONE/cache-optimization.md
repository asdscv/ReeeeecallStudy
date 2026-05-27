# Cache / Fetch-Efficiency Optimization — Design & Work Plan

> Status: ✅ Phase 1 SHIPPED (PR #114). Owner: platform.
> Shipped: single TTL cache utility (`shared/lib/cache/stale-cache.ts`) + shared
> deck-store migration + clean `invalidate()` API replacing brittle setState hacks.
> Follow-ups (§6) continue under `DOCS/TODO/cache-optimization-phase2.md`.
> Aligns with `DOCS/SERVICE_IMPROVEMENT_PLAN.md` → Phase 1 (Foundation: 성능 + 안정성).

## 0. Honest environment notes (no fabrication)

- There is **no `DOCS/STANDARD`** directory in this repo. The closest existing
  standard is `DOCS/SERVICE_IMPROVEMENT_PLAN.md` (phased plan) + `DOCS/DESIGN/*`.
  This document follows those conventions and is filed under `DOCS/TODO/`.
- There is **no Dockerfile / docker-compose / SonarQube** in this stack
  (Vite + Expo + Supabase + Cloudflare). Tests run with the project's real
  runner — **Vitest** — and the existing **GitHub Actions CI** (`.github/workflows/ci.yml`:
  Lint+Typecheck, Unit Tests, Integration, Migration Safety, Architecture Guard,
  Cloudflare Workers build). We use that pipeline rather than inventing a parallel one.
- No `react-query`/`swr`: data caching is hand-rolled inside Zustand stores.

## 1. Problem (root cause)

Client data caching is implemented ad-hoc and inconsistently:

| Location | Mechanism | Issue |
|---|---|---|
| `shared/stores/deck-store.ts` | 3× duplicated `if (!force && xFetchedAt && Date.now()-xFetchedAt < STALE_AFTER_MS) return` over `decksFetchedAt/statsFetchedAt/templatesFetchedAt` | duplication; freshness kept in Zustand **render state** though never read by UI |
| `shared/stores/admin-store.ts` | its own `fetchedAt` Record + `CACHE_TTL` + `isFresh()` + `forceRefresh()` | second independent implementation of the same idea |
| `shared/stores/card-store.ts`, `shared/stores/marketplace-store.ts` | invalidate by reaching into another store: `useDeckStore.setState({ statsFetchedAt: null })` | brittle — couples callers to deck-store's internal field names; silently no-ops on web (web deck-store has no such field) |
| `web/src/stores/*` | mostly **no** caching → refetch on every route mount | redundant network on web |

This duplication is also where the recent "must pull-to-refresh to see edits"
bug lived (stale cache + non-forced refetch). Consolidating + locking behavior
with tests reduces that whole class of bug.

## 2. Design — single pluggable TTL cache (SOLID)

New module `packages/shared/lib/cache/stale-cache.ts`:

- **SRP**: one concern — "is this keyed fetch still fresh?". No network, no UI,
  no Zustand coupling (freshness is not render state).
- **DIP / testability**: injectable `now()` clock → deterministic tests.
- **Open/extensible (plugin-ish)**: keyed entries + configurable `ttlMs`; any
  store creates its own instance. Future: per-key TTL override, `onEvict` hook.

```ts
interface StaleCache {
  isFresh(key): boolean
  markFetched(key): void
  invalidate(key?): void          // omit key → clear all
  shouldFetch(key, { force }): boolean   // force || !isFresh
}
createStaleCache({ ttlMs, now? }): StaleCache
```

## 3. Migration (this PR — reference implementation)

- Migrate `shared/stores/deck-store.ts` to `createStaleCache` (ttl 5min).
  - Remove `decksFetchedAt/statsFetchedAt/templatesFetchedAt` from Zustand state.
  - `fetchX`: `if (!cache.shouldFetch('x', opts)) return` … `cache.markFetched('x')` on success only (preserves "don't cache failed fetches").
  - Expose `invalidate(key?)` store action.
- Replace brittle invalidation:
  - `card-store.ts`: `useDeckStore.getState().invalidate('stats')`
  - `marketplace-store.ts`: `invalidate('decks'); invalidate('stats')`
- **Behavior-preserving**: same TTL, same `force` semantics, same success-only
  marking, same invalidation points (deck/card/marketplace mutations + focus).
- Scope guard: **web stores and `admin-store` are intentionally NOT changed here**
  to avoid stale-data regressions on surfaces the user is sensitive to. They are
  listed below as follow-ups behind the same utility.

## 4. Tests (real logic, not coverage filler)

`packages/web/src/lib/__tests__/stale-cache.test.ts` (runs under web Vitest, can
import `@reeeeecall/shared`): TTL boundary (fresh just before / stale at+after
ttl), `force` overrides freshness, `invalidate(key)` vs `invalidate()` (all),
unknown key, independent keys don't interfere, injected-clock determinism.

## 5. Verification gates

- `tsc` (mobile + web) clean.
- New `stale-cache` tests green; existing deck/store tests unaffected.
- Full CI green on the PR.

## 6. Follow-ups (documented, not done here)

- Migrate `admin-store.ts` (web admin) to the shared utility (drop its private `isFresh`).
- Opt-in TTL cache for web `deck-store`/`template`/`marketplace` reads to cut
  refetch-on-every-route — **gated on adding the same focus/mutation invalidation**
  the mobile side has, so it can't reintroduce stale reads.
- Consider HTTP/Cloudflare cache headers + Expo prefetch tuning as separate tracks.
