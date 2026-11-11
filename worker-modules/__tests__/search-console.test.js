import { describe, it, expect, vi, afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import { buildServiceAccountJwt, fetchSearchQueries, getGscConfig, queryWindow, DEFAULT_GSC_SITE_URL } from '../search-console.js'

async function makeServiceAccount() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', privateKey)).toString('base64')
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`
  return { sa: { client_email: 'planner@proj.iam.gserviceaccount.com', private_key: pem }, publicKey }
}

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

afterEach(() => vi.unstubAllGlobals())

describe('buildServiceAccountJwt', () => {
  it('produces an RS256 JWT Google can verify with the account key', async () => {
    const { sa, publicKey } = await makeServiceAccount()
    const jwt = await buildServiceAccountJwt(sa, 1_700_000_000)
    const [h, c, s] = jwt.split('.')
    expect(JSON.parse(b64urlDecode(h))).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(b64urlDecode(c))).toEqual({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    })
    const ok = await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })
})

describe('queryWindow', () => {
  it('ends before the reporting lag and spans the requested days inclusive', () => {
    expect(queryWindow(new Date('2026-11-11T06:00:00Z'), 28, 3)).toEqual({ startDate: '2026-10-12', endDate: '2026-11-08' })
  })
})

describe('getGscConfig', () => {
  it('defaults the property and tolerates a missing or broken secret', () => {
    expect(getGscConfig({})).toEqual({ serviceAccount: null, siteUrl: DEFAULT_GSC_SITE_URL })
    expect(getGscConfig({ GSC_SERVICE_ACCOUNT_JSON: '{nope' }).serviceAccount).toBeNull()
    expect(getGscConfig({ GSC_SERVICE_ACCOUNT_JSON: '{"client_email":"a"}', GSC_SITE_URL: 'https://x.y/' }))
      .toEqual({ serviceAccount: { client_email: 'a' }, siteUrl: 'https://x.y/' })
  })
})

describe('fetchSearchQueries', () => {
  it('exchanges the JWT for a token and maps query rows', async () => {
    const { sa } = await makeServiceAccount()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        rows: [{ keys: ['toeic part 5'], clicks: 0, impressions: 160, ctr: 0, position: 48.2 }],
      })))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchSearchQueries({ serviceAccount: sa, siteUrl: 'sc-domain:reeeeecallstudy.xyz' }, { now: new Date('2026-11-11T06:00:00Z') })

    expect(rows).toEqual([{ query: 'toeic part 5', clicks: 0, impressions: 160, ctr: 0, position: 48.2 }])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Areeeeecallstudy.xyz/searchAnalytics/query')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toMatchObject({ dimensions: ['query'], startDate: '2026-10-12', endDate: '2026-11-08' })
  })

  it('surfaces a permission error instead of returning nothing', async () => {
    const { sa } = await makeServiceAccount()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' })))
      .mockResolvedValueOnce(new Response('User does not have sufficient permission', { status: 403 })))
    await expect(fetchSearchQueries({ serviceAccount: sa, siteUrl: 'sc-domain:x' })).rejects.toThrow('GSC query failed: 403')
  })
})
