/**
 * TTL-based staleness cache for store data fetches.
 *
 * Centralizes the "skip the network refetch if we fetched within the TTL,
 * unless the caller forces it" pattern that was hand-rolled and duplicated
 * across stores (deck-store's per-field `*FetchedAt` checks, admin-store's
 * private `fetchedAt` map, …). One tested implementation instead of N.
 *
 * Design:
 *   - Single responsibility: answers "is this keyed fetch still fresh?".
 *     No network, no UI, no Zustand coupling — freshness is not render state,
 *     so it lives outside component state and never triggers re-renders.
 *   - Dependency-injectable clock (`now`) so TTL behavior is deterministic
 *     under test without faking the global `Date`.
 *   - Keyed + per-instance TTL → extensible: a store keeps one cache instance
 *     and namespaces its resources by key ('decks' | 'stats' | …).
 */

export interface StaleCacheOptions {
  /** Freshness window in milliseconds. Entries older than this are stale. */
  ttlMs: number
  /** Clock source; injectable for tests. Defaults to `Date.now`. */
  now?: () => number
}

export interface StaleCache {
  /** True when `key` was fetched within the TTL and not invalidated since. */
  isFresh(key: string): boolean
  /** Record a *successful* fetch for `key`, starting/refreshing its TTL window. */
  markFetched(key: string): void
  /** Drop freshness for one `key`, or for every key when `key` is omitted. */
  invalidate(key?: string): void
  /**
   * Whether a fetch should run now: true if `force` is set, or the key is stale.
   * Convenience wrapper so call sites read `if (!cache.shouldFetch(k, opts)) return`.
   */
  shouldFetch(key: string, opts?: { force?: boolean }): boolean
}

export function createStaleCache({ ttlMs, now = Date.now }: StaleCacheOptions): StaleCache {
  const fetchedAt = new Map<string, number>()

  const isFresh = (key: string): boolean => {
    const t = fetchedAt.get(key)
    return t !== undefined && now() - t < ttlMs
  }

  return {
    isFresh,
    markFetched(key) {
      fetchedAt.set(key, now())
    },
    invalidate(key) {
      if (key === undefined) fetchedAt.clear()
      else fetchedAt.delete(key)
    },
    shouldFetch(key, opts) {
      return opts?.force === true || !isFresh(key)
    },
  }
}
