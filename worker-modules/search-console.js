// Google Search Console (Search Analytics) reader for the daily keyword planner.
//
// Auth is a service account: sign an RS256 JWT with WebCrypto, trade it for an access
// token, then query. No SDK — the Worker runtime has fetch + crypto.subtle and nothing else.
// The service account must be added as a user on the Search Console property (read is enough).

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const DEFAULT_GSC_SITE_URL = 'sc-domain:reeeeecallstudy.xyz'

export function getGscConfig(env) {
  let serviceAccount = null
  if (env.GSC_SERVICE_ACCOUNT_JSON) {
    try {
      serviceAccount = JSON.parse(env.GSC_SERVICE_ACCOUNT_JSON)
    } catch {
      serviceAccount = null
    }
  }
  return {
    serviceAccount,
    siteUrl: env.GSC_SITE_URL || DEFAULT_GSC_SITE_URL,
  }
}

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  const der = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i)
  return der.buffer
}

export async function buildServiceAccountJwt(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64url(signature)}`
}

async function getAccessToken(serviceAccount) {
  const assertion = await buildServiceAccountJwt(serviceAccount)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`GSC token exchange failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

// Search Console finalizes data ~2-3 days late; the window ends before that gap so a
// query's numbers don't look like "zero clicks" just because today isn't counted yet.
export function queryWindow(now = new Date(), days = 28, lagDays = 3) {
  const end = new Date(now.getTime() - lagDays * 86400000)
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

/**
 * Per-query clicks/impressions/position for the site over the window.
 * @returns {Promise<Array<{query:string, clicks:number, impressions:number, ctr:number, position:number}>>}
 */
export async function fetchSearchQueries(config, { now = new Date(), days = 28, rowLimit = 1000 } = {}) {
  const token = await getAccessToken(config.serviceAccount)
  const { startDate, endDate } = queryWindow(now, days)
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions: ['query'], type: 'web', rowLimit }),
    },
  )
  if (!res.ok) throw new Error(`GSC query failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return (data.rows || []).map((r) => ({
    query: r.keys?.[0] || '',
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }))
}
