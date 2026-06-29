import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleSitemapArticles } from '../seo/sitemap.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }

afterEach(() => vi.unstubAllGlobals())

describe('handleSitemapArticles — indexable-only filtering', () => {
  it('includes articles with an indexable locale, drops minor-language-only ones', async () => {
    const rows = [
      { slug: 'has-en', locale: 'en', updated_at: '2026-01-01', title: 'A', og_image_url: null, thumbnail_url: null },
      { slug: 'has-en', locale: 'ja', updated_at: '2026-01-02', title: 'A', og_image_url: null, thumbnail_url: null },
      { slug: 'ja-only', locale: 'ja', updated_at: '2026-01-03', title: 'B', og_image_url: null, thumbnail_url: null },
      { slug: 'ko-only', locale: 'ko', updated_at: '2026-01-04', title: 'C', og_image_url: null, thumbnail_url: null },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })))

    const res = await handleSitemapArticles(env)
    const xml = await res.text()

    expect(xml).toContain('/insight/has-en</loc>')  // has en → included
    expect(xml).toContain('/insight/ko-only</loc>')  // ko is indexable → included
    expect(xml).not.toContain('/insight/ja-only')    // ja-only → excluded entirely

    // hreflang for the multi-locale article: en yes, ja no (not indexable)
    expect(xml).toContain('hreflang="en"')
    expect(xml).not.toContain('hreflang="ja"')
  })
})
