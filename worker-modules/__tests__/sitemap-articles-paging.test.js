import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleSitemapArticles, handleSitemapStatic } from '../seo/sitemap.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }
afterEach(() => vi.unstubAllGlobals())

describe('article sitemap completeness', () => {
  it('keeps all canonical language URLs beyond the 1000-row REST ceiling', async () => {
    const rows = Array.from({ length: 1682 }, (_, i) => ({
      slug: `article-${Math.floor(i / 2)}`, locale: i % 2 ? 'ko' : 'en',
      updated_at: '2026-10-06', title: `Article ${i}`,
    }))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = new URL(input)
      calls.push(url)
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000)
      return { ok: true, json: async () => rows.slice(offset, offset + limit) }
    }))
    const response = await handleSitemapArticles(env)
    const xml = await response.text()
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
    expect(locs).toHaveLength(1682)
    expect(new Set(locs).size).toBe(1682)
    expect(locs).toContain('https://reeeeecallstudy.xyz/insight/article-840?lang=ko')
    expect(locs).toContain('https://reeeeecallstudy.xyz/insight/article-840')
    expect(calls).toHaveLength(4)
    expect(calls.every((u) => u.searchParams.get('order').includes('id.asc'))).toBe(true)
    expect(calls.every((u) => u.searchParams.get('locale') === 'in.(en,ko)')).toBe(true)
  })

  it('does not cache an empty or partial sitemap when a later page fails', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ slug: `a-${i}`, locale: 'en', updated_at: '2026-10-06', title: 'A' }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => rows })
      .mockResolvedValueOnce({ ok: false, status: 503 }))
    const response = await handleSitemapArticles(env)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).not.toContain('<urlset')
  })

  it('lists English and Korean landing and insight canonicals separately', async () => {
    const xml = await (await handleSitemapStatic()).text()
    expect(xml.match(/<url>/g)).toHaveLength(4)
    expect(xml).toContain('/landing?lang=ko</loc>')
    expect(xml).toContain('/insight?lang=ko</loc>')
    expect(xml).not.toContain('lang=ja')
  })
})
