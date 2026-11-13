import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleContentDetailBot } from '../seo/handlers/content-detail.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }

const p = (text) => ({ type: 'paragraph', props: { text } })
const h = (text) => ({ type: 'heading', props: { level: 2, text } })

const ARTICLE = {
  slug: 'toeic-part-5', locale: 'en',
  title: 'TOEIC Part 5', meta_title: 'TOEIC Part 5', meta_description: 'd',
  content_blocks: [
    { type: 'hero', props: { title: 'TOEIC Part 5' } }, p('Intro.'),
    h('What is Part 5?'), p('The answer.'), p('More.'),
    h('Common traps'), p('Traps.'),
    h('Bottom line'), p('Wrap.'),
    { type: 'cta', props: { title: 'Start', description: 'd', buttonText: 'Go', buttonUrl: '/auth/login' } },
  ],
  tags: ['toeic'], reading_time_minutes: 5, author_name: 'ReeeeecallStudy',
  published_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('crawler HTML carries the same drop-off app links as the page', () => {
  it('renders two store-link blocks, attributed to this article', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      if (u.includes('neq')) return { ok: true, json: async () => [] }
      if (u.includes('select=locale')) return { ok: true, json: async () => [{ locale: 'en' }] }
      return { ok: true, json: async () => [ARTICLE] }
    }))
    const res = await handleContentDetailBot('toeic-part-5', new URL('https://reeeeecallstudy.xyz/insight/toeic-part-5'), env)
    const html = await res.text()

    expect(html.match(/<aside><a href="https:\/\/apps\.apple\.com\//g)).toHaveLength(2)
    expect(html).toContain('utm_campaign%3Dtoeic-part-5%26utm_content%3Danswer')
    expect(html).toContain('utm_content%3Dwrap_up')
    expect(html.indexOf('The answer.')).toBeLessThan(html.indexOf('<aside><a'))
  })
})
