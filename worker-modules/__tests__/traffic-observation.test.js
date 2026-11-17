import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeTraffic } from '../traffic-observation.js'
import { isBot } from '../seo/bot-detector.js'

const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_KEY: 'private-service-key' }
const html = () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
afterEach(() => vi.unstubAllGlobals())
describe('document traffic observations', () => {
  it('identifies GoogleOther for prerendering, so it cannot inflate browser visits', () => {
    expect(isBot('Mozilla/5.0 Mobile Safari/537.36 (compatible; GoogleOther)')).toBe(true)
  })
  it('records server-provided bot/country data without query strings, cookies or IPs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const req = new Request('https://reklue.com/insight/article?token=private', { headers: {
      'user-agent': 'GoogleOther', referer: 'https://search.example.com/q?secret=private', cookie: 'session=private', 'cf-connecting-ip': '1.2.3.4',
    } })
    req.cf = { country: 'US', asn: 15169, botManagement: { verifiedBot: true } }
    await observeTraffic(req, html(), env)
    const body = JSON.parse(fetch.mock.calls[0][1].body).p_payload
    expect(body).toMatchObject({ hostname: 'reklue.com', page_path: '/insight/article', verified_bot: true, country: 'US', asn: 15169, referrer: 'https://search.example.com' })
    expect(JSON.stringify(body)).not.toContain('private')
    expect(JSON.stringify(body)).not.toContain('1.2.3.4')
  })
  it.each(['/admin','/admin/contents','/auth/callback'])('excludes sensitive path %s', async path => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await observeTraffic(new Request(`https://reklue.com${path}`), html(), env)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ dnt: '1' }, { 'sec-gpc': '1' }, { cookie: 'session=x; reklue_analytics_opt_out=1' }])('honors privacy preference %j', async headers => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await observeTraffic(new Request('https://reklue.com/', { headers }), html(), env)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not log static assets or deployments without service credentials', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await observeTraffic(new Request('https://reklue.com/asset.js'), new Response('js'), env)
    await observeTraffic(new Request('https://reklue.com/'), html(), {})
    expect(fetch).not.toHaveBeenCalled()
  })
})
