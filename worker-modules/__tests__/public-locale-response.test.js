import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../../worker.js'
import { handleRSSFeed } from '../seo/feeds.js'

afterEach(() => vi.unstubAllGlobals())

describe('public response locale consistency', () => {
  it.each(['/landing?lang=ja', '/insight?lang=zh', '/?lang=es'])('preserves noindex on human HTML for %s', async (path) => {
    const assets = { fetch: vi.fn(async () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html', Vary: 'Accept-Encoding' } })) }
    const response = await worker.fetch(new Request(`https://reeeeecallstudy.xyz${path}`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140' } }), { ASSETS: assets })
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, User-Agent')
    expect(await response.text()).toContain('app')
  })

  it('serves the full Korean article to Claude search instead of the SPA', async () => {
    const article = { slug: 'korean', locale: 'ko', canonical_url: 'https://reeeeecallstudy.xyz/insight/korean', title: '한국어 기사', content_blocks: [{ type: 'paragraph', props: { text: '실제 기사 본문' } }], tags: [] }
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      return { ok: true, json: async () => url.includes('select=locale') ? [{ locale: 'ko' }] : url.includes('neq') ? [] : [article] }
    }))
    const assets = { fetch: vi.fn() }
    const response = await worker.fetch(new Request('https://reeeeecallstudy.xyz/insight/korean?lang=ko', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Claude-SearchBot/1.0)' },
    }), { ASSETS: assets, SUPABASE_ANON_KEY: 'anon' })
    expect(assets.fetch).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('실제 기사 본문')
    expect(html).toContain('<html lang="ko">')
    expect(html).toContain('hreflang="x-default" href="https://reeeeecallstudy.xyz/insight/korean?lang=ko"')
    expect(html).not.toContain('hreflang="en"')
    expect(html).toContain('rel="canonical" href="https://reeeeecallstudy.xyz/insight/korean?lang=ko"')
    expect(html).toContain('"@id":"https://reeeeecallstudy.xyz/insight/korean?lang=ko"')
  })

  it.each(['rss', 'atom', 'json'])('links %s feed items to their actual Korean content', async (format) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ slug: 'korean', title: '한국어 기사', published_at: '2026-10-06', tags: [] }] })))
    const text = await (await handleRSSFeed({ SUPABASE_ANON_KEY: 'anon' }, format, 'ko')).text()
    expect(text).toContain('/insight/korean?lang=ko')
    if (format === 'rss') expect(text).toContain('<language>ko</language>')
    if (format === 'json') expect(JSON.parse(text).language).toBe('ko')
  })
})
