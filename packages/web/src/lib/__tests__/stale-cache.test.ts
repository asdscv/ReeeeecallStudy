import { describe, it, expect } from 'vitest'
import { createStaleCache } from '@reeeeecall/shared/lib/cache/stale-cache'

// A controllable clock so TTL behavior is deterministic (no real timers / Date faking).
function fakeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createStaleCache', () => {
  it('treats an un-fetched key as stale and in need of fetching', () => {
    const cache = createStaleCache({ ttlMs: 1000, now: fakeClock().now })
    expect(cache.isFresh('decks')).toBe(false)
    expect(cache.shouldFetch('decks')).toBe(true)
  })

  it('is fresh immediately after markFetched', () => {
    const clock = fakeClock()
    const cache = createStaleCache({ ttlMs: 1000, now: clock.now })
    cache.markFetched('decks')
    expect(cache.isFresh('decks')).toBe(true)
    expect(cache.shouldFetch('decks')).toBe(false)
  })

  it('stays fresh just before the TTL boundary and goes stale at/after it', () => {
    const clock = fakeClock()
    const cache = createStaleCache({ ttlMs: 1000, now: clock.now })
    cache.markFetched('decks')

    clock.advance(999)
    expect(cache.isFresh('decks')).toBe(true) // 999 < 1000

    clock.advance(1) // now exactly 1000
    expect(cache.isFresh('decks')).toBe(false) // boundary is exclusive

    clock.advance(5000)
    expect(cache.isFresh('decks')).toBe(false)
  })

  it('force overrides freshness in shouldFetch', () => {
    const cache = createStaleCache({ ttlMs: 1000, now: fakeClock().now })
    cache.markFetched('decks')
    expect(cache.isFresh('decks')).toBe(true)
    expect(cache.shouldFetch('decks', { force: true })).toBe(true)
    expect(cache.shouldFetch('decks', { force: false })).toBe(false)
  })

  it('invalidate(key) drops only that key', () => {
    const cache = createStaleCache({ ttlMs: 1000, now: fakeClock().now })
    cache.markFetched('decks')
    cache.markFetched('stats')

    cache.invalidate('stats')
    expect(cache.isFresh('stats')).toBe(false)
    expect(cache.isFresh('decks')).toBe(true) // untouched
  })

  it('invalidate() with no key clears every entry', () => {
    const cache = createStaleCache({ ttlMs: 1000, now: fakeClock().now })
    cache.markFetched('decks')
    cache.markFetched('stats')
    cache.markFetched('templates')

    cache.invalidate()
    expect(cache.isFresh('decks')).toBe(false)
    expect(cache.isFresh('stats')).toBe(false)
    expect(cache.isFresh('templates')).toBe(false)
  })

  it('keeps keys independent', () => {
    const clock = fakeClock()
    const cache = createStaleCache({ ttlMs: 1000, now: clock.now })
    cache.markFetched('decks')
    clock.advance(500)
    cache.markFetched('stats') // fetched later → its window started later

    clock.advance(600) // decks at 1100 (stale), stats at 600 (fresh)
    expect(cache.isFresh('decks')).toBe(false)
    expect(cache.isFresh('stats')).toBe(true)
  })

  it('re-marking refreshes the TTL window', () => {
    const clock = fakeClock()
    const cache = createStaleCache({ ttlMs: 1000, now: clock.now })
    cache.markFetched('decks')
    clock.advance(900)
    cache.markFetched('decks') // refresh
    clock.advance(900) // 900 since refresh < 1000
    expect(cache.isFresh('decks')).toBe(true)
  })

  it('invalidating an unknown key is a no-op', () => {
    const cache = createStaleCache({ ttlMs: 1000, now: fakeClock().now })
    expect(() => cache.invalidate('nope')).not.toThrow()
    expect(cache.isFresh('nope')).toBe(false)
  })
})
