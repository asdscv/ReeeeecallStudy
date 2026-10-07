import { describe, it, expect } from 'vitest'
import { isBot } from '../seo/bot-detector.js'
import { handleLandingBotRequest } from '../seo/handlers/landing.js'
import { handleRobots } from '../seo/robots.js'
import { LANDING_COPY, UI_LOCALES } from '../seo/constants.js'
import { escapeHtml } from '../seo/helpers.js'

describe('AEO public content', () => {
  it.each(['Claude-SearchBot', 'Claude-User', 'Perplexity-User', 'OAI-SearchBot'])('prerenders for %s', (ua) => {
    expect(isBot(`Mozilla/5.0 (compatible; ${ua}/1.0)`)).toBe(true)
    expect(isBot('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toBe(false)
  })

  it.each(UI_LOCALES)('uses the visible landing FAQ and metadata for %s', async (lang) => {
    const response = await handleLandingBotRequest(new URL(`https://reeeeecallstudy.xyz/landing?lang=${lang}`))
    const html = await response.text()
    const copy = LANDING_COPY[lang]
    expect(html).toContain(`<title>${escapeHtml(copy.seo.title)}</title>`)
    expect(html).toContain(escapeHtml(copy.faq.a2))
    expect(html).toContain(escapeHtml(copy.faq.a3))
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]))
    expect(schemas.map((s) => s['@type'])).not.toContain('Course')
    expect(schemas.map((s) => s['@type'])).not.toContain('ProfilePage')
    expect(schemas.some((s) => s.aggregateRating)).toBe(false)
    expect(schemas.find((s) => s['@type'] === 'FAQPage').mainEntity[1].acceptedAnswer.text).toBe(copy.faq.a2)
    expect(response.headers.get('X-Robots-Tag').startsWith(lang === 'en' || lang === 'ko' ? 'index' : 'noindex')).toBe(true)
    expect(response.headers.get('Vary')).toContain('User-Agent')
  })

  it('lets search/retrieval bots discover the public home and context files without opening private routes', async () => {
    const robots = await handleRobots({}).text()
    for (const bot of ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
      const block = robots.split(`User-agent: ${bot}\n`)[1].split('\n\n')[0]
      expect(block).toContain('Allow: /$')
      expect(block).toContain('Allow: /llms.txt$')
      expect(block).toContain('Allow: /sitemap.xml$')
      expect(block).toContain('Disallow: /')
      expect(block).not.toContain('Allow: /auth')
    }
  })
})
