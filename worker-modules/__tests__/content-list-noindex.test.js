import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleContentListBot } from '../seo/handlers/content-list.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }
afterEach(() => vi.unstubAllGlobals())

function stubEmptyList() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
}

describe('content-list noindex policy (real handler behaviour)', () => {
  it('a non-indexable (?lang=ja) list page is served noindex on both channels', async () => {
    stubEmptyList()
    const res = await handleContentListBot(new URL('https://reeeeecallstudy.xyz/insight?lang=ja'), env)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    const html = await res.text()
    expect(html).toContain('<meta name="robots" content="noindex, follow">')
  })

  it('the default (en) list page stays indexable with en/ko hreflang only', async () => {
    stubEmptyList()
    const res = await handleContentListBot(new URL('https://reeeeecallstudy.xyz/insight'), env)
    expect(res.headers.get('X-Robots-Tag')).toContain('index, follow')
    const html = await res.text()
    expect(html).toContain('hreflang="en"')
    expect(html).toContain('hreflang="ko"')
    expect(html).not.toContain('hreflang="ja"')
  })

  it('a malformed ?lang= (injection attempt) is normalized to en — no reflected markup', async () => {
    stubEmptyList()
    const res = await handleContentListBot(
      new URL('https://reeeeecallstudy.xyz/insight?lang=%22%3E%3Cscript%3Ealert(1)%3C/script%3E'),
      env,
    )
    expect(res.headers.get('X-Robots-Tag')).toContain('index') // normalized → en, indexable
    const html = await res.text()
    expect(html).not.toContain('"><script>')
    expect(html).not.toContain('<script>alert(1)')
  })
})
