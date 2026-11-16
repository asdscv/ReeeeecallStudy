import { describe, expect, it, vi } from 'vitest'
import worker from '../../worker.js'
import { currentSiteAddress } from '../../packages/shared/lib/site-url.ts'
import { contentCanonicalUrl } from '../../packages/shared/lib/content-canonical.ts'

describe('Reklue domain move', () => {
  it('upgrades the canonical host to HTTPS with the return path intact', async () => {
    const response = await worker.fetch(new Request('http://reklue.com/auth/callback?code=existing-code'), {})
    expect(response.status).toBe(308)
    expect(response.headers.get('Location')).toBe('https://reklue.com/auth/callback?code=existing-code')
  })

  it('continues serving a local HTTP development origin', async () => {
    const assets = { fetch: vi.fn(async () => new Response('local')) }
    const response = await worker.fetch(new Request('http://localhost:5197/logo-text.png'), { ASSETS: assets })
    expect(await response.text()).toBe('local')
  })

  it.each(['reeeeecallstudy.xyz', 'www.reeeeecallstudy.xyz', 'www.reklue.com'])(
    'redirects %s while retaining an existing invite path and query', async (host) => {
      const assets = { fetch: vi.fn() }
      const response = await worker.fetch(new Request(`https://${host}/invite/existing-code?lang=ko&next=%2Fdecks`), { ASSETS: assets })
      expect(response.status).toBe(308)
      expect(response.headers.get('Location')).toBe('https://reklue.com/invite/existing-code?lang=ko&next=%2Fdecks')
      expect(assets.fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['reklue.com', 'localhost:5197', 'reeeeecallstudy-staging.example.workers.dev'])(
    'continues serving %s without a redirect', async (host) => {
      const assets = { fetch: vi.fn(async () => new Response('asset')) }
      const response = await worker.fetch(new Request(`https://${host}/logo-text.png`), { ASSETS: assets })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('asset')
    },
  )

  it('moves stored canonical URLs without losing language or editorial overrides', () => {
    expect(contentCanonicalUrl('https://reklue.com', 'practice', 'ko', 'https://reeeeecallstudy.xyz/insight/practice'))
      .toBe('https://reklue.com/insight/practice?lang=ko')
    expect(contentCanonicalUrl('https://reklue.com', 'practice', 'ko', 'https://editor.example/article'))
      .toBe('https://editor.example/article')
    expect(currentSiteAddress('https://reeeeecallstudy.xyz.evil.example/path'))
      .toBe('https://reeeeecallstudy.xyz.evil.example/path')
  })
})
