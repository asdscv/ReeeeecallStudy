/**
 * Every active deck has to reach the sitemap.
 *
 * The deck catalog is the only acquisition surface that scales — 650 public `/d/:id`
 * pages, each server-rendered with a localized title and description. The query behind
 * the listings sitemap asked for `limit=500`, so 150 of those 650 decks were never
 * submitted to any search engine. Nothing errored; the URLs were simply absent.
 *
 * Raising the number is not the fix. PostgREST caps a response at `max_rows` (1000 in
 * production) and quietly ignores a larger `limit`, so the same silence returns once the
 * catalog passes that line. Paging is what actually holds.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleSitemapListings } from '../seo/sitemap.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }

afterEach(() => vi.unstubAllGlobals())

/** A PostgREST stand-in that honours offset/limit and refuses to return more than max_rows. */
function stubRest(total, maxRows = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `deck-${String(i).padStart(4, '0')}`,
    updated_at: '2026-01-01T00:00:00Z',
  }))
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = new URL(url)
    const offset = Number(u.searchParams.get('offset') ?? 0)
    const limit = Math.min(Number(u.searchParams.get('limit') ?? maxRows), maxRows)
    calls.push({ offset, limit, order: u.searchParams.get('order') })
    return { ok: true, json: async () => rows.slice(offset, offset + limit) }
  }))
  return { calls, rows }
}

const locCount = (xml) => (xml.match(/<loc>/g) ?? []).length

describe('handleSitemapListings — no deck is silently dropped', () => {
  it('emits every deck when the catalog exceeds one page', async () => {
    stubRest(650)
    const xml = await (await handleSitemapListings(env)).text()
    expect(locCount(xml)).toBe(650)
    expect(xml).toContain('/d/deck-0000</loc>')
    expect(xml).toContain('/d/deck-0649</loc>')  // the tail that limit=500 lost
  })

  it('keeps paging past the PostgREST max_rows ceiling', async () => {
    stubRest(1500, 1000)
    const xml = await (await handleSitemapListings(env)).text()
    expect(locCount(xml)).toBe(1500)
    expect(xml).toContain('/d/deck-1499</loc>')
  })

  it('emits each deck exactly once', async () => {
    stubRest(650)
    const xml = await (await handleSitemapListings(env)).text()
    const ids = [...xml.matchAll(/\/d\/(deck-\d+)</g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('orders by a unique tiebreaker so pages cannot repeat or skip rows', async () => {
    const { calls } = stubRest(650)
    await handleSitemapListings(env)
    // created_at is not unique across a bulk import; id settles the order.
    for (const c of calls) expect(c.order).toMatch(/id\./)
  })

  it('stops instead of looping when a page comes back empty', async () => {
    const { calls } = stubRest(1000)
    await handleSitemapListings(env)
    expect(calls.length).toBeLessThan(10)
  })

  it('still answers with valid XML when the catalog is empty', async () => {
    stubRest(0)
    const xml = await (await handleSitemapListings(env)).text()
    expect(locCount(xml)).toBe(0)
    expect(xml).toContain('</urlset>')
  })
})
