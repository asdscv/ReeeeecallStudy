import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleContentDetailBot } from '../seo/handlers/content-detail.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }

function article(locale, slug = 'foo') {
  return {
    slug, locale,
    title: `T-${locale}`, subtitle: `S-${locale}`,
    meta_title: `M-${locale}`, meta_description: `D-${locale}`,
    content_blocks: [{ type: 'paragraph', props: { text: 'Body text.' } }],
    tags: ['study'], reading_time_minutes: 5,
    author_name: 'ReeeeecallStudy',
    published_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  }
}

// Handler now does: (1) select=locale (present locales), (2) locale=eq.<chosen>&limit=1
// (full article), plus a related query (slug=neq...). Discriminate by URL shape.
function stubFetch(rows) {
  vi.stubGlobal('fetch', vi.fn(async (urlStr) => {
    if (urlStr.includes('neq')) return { ok: true, json: async () => [] } // related
    if (urlStr.includes('select=locale')) {
      return { ok: true, json: async () => rows.map((r) => ({ locale: r.locale })) } // present set
    }
    const m = urlStr.match(/locale=eq\.([a-z-]+)/) // chosen article fetch
    const loc = m && m[1]
    return { ok: true, json: async () => rows.filter((r) => r.locale === loc).slice(0, 1) }
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('content-detail noindex policy (real handler behaviour)', () => {
  it('a non-indexable (ja) article is served noindex with NO ja hreflang', async () => {
    stubFetch([article('ja')])
    const url = new URL('https://reeeeecallstudy.xyz/insight/foo?lang=ja')
    const res = await handleContentDetailBot('foo', url, env)
    expect(res).toBeTruthy()
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    const html = await res.text()
    expect(html).toContain('<meta name="robots" content="noindex, follow">')
    expect(html).not.toContain('hreflang="ja"') // ja not indexable → excluded
  })

  it('an indexable (en) article is served index with en hreflang', async () => {
    stubFetch([article('en', 'bar')])
    const url = new URL('https://reeeeecallstudy.xyz/insight/bar')
    const res = await handleContentDetailBot('bar', url, env)
    expect(res.headers.get('X-Robots-Tag')).toContain('index, follow')
    const html = await res.text()
    expect(html).toContain('<meta name="robots" content="index, follow')
    expect(html).toContain('hreflang="en"')
  })

  it('?lang=ja with only an en row falls back to en and stays indexable', async () => {
    stubFetch([article('en', 'baz')])
    const url = new URL('https://reeeeecallstudy.xyz/insight/baz?lang=ja')
    const res = await handleContentDetailBot('baz', url, env)
    expect(res.headers.get('X-Robots-Tag')).toContain('index') // served en
  })

  it('hreflang covers en+ko when both exist, excludes the non-indexable ja', async () => {
    stubFetch([article('en', 'multi'), article('ko', 'multi'), article('ja', 'multi')])
    const url = new URL('https://reeeeecallstudy.xyz/insight/multi')
    const res = await handleContentDetailBot('multi', url, env)
    const html = await res.text()
    expect(html).toContain('hreflang="en"')
    expect(html).toContain('hreflang="ko"')
    expect(html).not.toContain('hreflang="ja"')
  })
})
