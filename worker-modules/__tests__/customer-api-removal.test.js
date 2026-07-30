import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../worker.js'
import { matchBotRoute } from '../seo/page-registry.js'
import { handleSitemapStatic } from '../seo/sitemap.js'

const makeEnv = () => ({
  ASSETS: { fetch: vi.fn(async () => new Response('asset fallback', { status: 200 })) },
})

afterEach(() => vi.unstubAllGlobals())

describe('customer external API removal', () => {
  it('does not proxy /api requests to a Supabase customer API function', async () => {
    const outboundFetch = vi.fn(async () => {
      throw new Error('unexpected outbound customer API proxy')
    })
    vi.stubGlobal('fetch', outboundFetch)
    const env = makeEnv()
    const request = new Request('https://reeeeecallstudy.xyz/api/decks', {
      headers: { Authorization: 'Bearer removed-customer-credential' },
    })

    const response = await worker.fetch(request, env)

    expect(await response.text()).toBe('asset fallback')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('does not register or advertise the removed /docs/api route', async () => {
    expect(matchBotRoute('/docs/api')).toBeNull()
    expect(matchBotRoute('/docs/api/')).toBeNull()

    const response = await handleSitemapStatic()
    expect(await response.text()).not.toContain('/docs/api')
  })

  it('does not advertise a public REST API to LLM crawlers', () => {
    const llms = readFileSync(new URL('../../packages/web/public/llms.txt', import.meta.url), 'utf8')
    const llmsFull = readFileSync(new URL('../../packages/web/public/llms-full.txt', import.meta.url), 'utf8')

    for (const content of [llms, llmsFull]) {
      expect(content).not.toContain('/docs/api')
      expect(content).not.toMatch(/public REST API/i)
    }
  })
})
