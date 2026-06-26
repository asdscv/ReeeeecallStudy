/**
 * Integration test — REST API (Edge function) cross-tenant authorization (H4).
 *
 * The api edge function runs as service-role (RLS bypassed); every handler must
 * scope DB access to the caller's userId. This suite proves user B can NOT
 * read/mutate user A's resources through ANY endpoint (the "multiplier" risk:
 * a future dropped filter = instant cross-tenant). Positive controls confirm A
 * can access its own.
 *
 * RUN REQUIREMENTS:
 *   - `supabase start` + migrations applied; SUPABASE_ANON/SERVICE_ROLE_KEY env.
 *   - The api function must be reachable WITHOUT the platform JWT gateway, since
 *     it authenticates raw `rc_` keys itself (not Supabase JWTs). Serve it with:
 *         supabase functions serve api --no-verify-jwt
 *     In the default `supabase start` setup the gateway (verify_jwt) rejects raw
 *     `rc_` keys, so this suite SKIPS with a clear reason rather than failing —
 *     the prod API is gateway-blocked today, so there is no live exposure to
 *     regress; this suite is the safety net for if/when the API is enabled.
 *   - service_role needs EXECUTE on resolve_api_key (migration 107) + default
 *     table grants (present on prod / pinned CLI).
 *
 * Verified locally (9/9) with `functions serve --no-verify-jwt`.
 */
import { describe, it, beforeAll, expect } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID, createHash } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const haveLocal = !!SERVICE_ROLE_KEY && !!ANON_KEY
const itLocal = haveLocal ? it : it.skip

// function `api` mounted at /functions/v1/api; routes are /v1/... (the runtime
// maps the mount onto Hono's basePath '/api').
const API_BASE = `${SUPABASE_URL}/functions/v1/api/v1`
const TEST_PASSWORD = 'test-password-12345'
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')

let admin: SupabaseClient
let A: { id: string; key: string }
let B: { id: string; key: string }
let aDeckId = ''
let aTemplateId = ''
let aCardId = ''
let aListingId = ''
let aShareId = ''
// Set true only once the FUNCTION (not the gateway) answers; otherwise tests skip.
let ready = false
let skipReason = ''

async function createUserWithKey(tag: string): Promise<{ id: string; key: string }> {
  const email = `${tag}-${randomUUID().slice(0, 8)}@cross-tenant.test`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: TEST_PASSWORD, email_confirm: true,
  })
  if (error) throw error
  const id = data.user!.id
  // Insert the api_key via the USER's own authenticated client (RLS "Users
  // manage own keys" allows self-insert) — avoids depending on service-role
  // table grants, which differ across local CLI versions.
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInErr) throw signInErr
  const key = `rc_test_${randomUUID().replace(/-/g, '')}`
  const { error: kErr } = await client.from('api_keys').insert({ user_id: id, key_hash: sha256hex(key), name: 'xtenant-test' })
  if (kErr) throw kErr
  return { id, key }
}

async function api(key: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* no body */ }
  return { status: res.status, json }
}

beforeAll(async () => {
  if (!haveLocal) return
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Reachable only if the FUNCTION answers (verify_jwt off). The gateway rejects
  // raw rc_ keys with {code:'UNAUTHORIZED_INVALID_JWT_FORMAT'}; the function
  // answers a bogus key with {error:{code:'INVALID_API_KEY'}}.
  for (let i = 0; i < 8 && !ready && !skipReason; i++) {
    try {
      const ping = await api('rc_bogus', 'GET', '/me')
      if (ping.json?.error?.code === 'INVALID_API_KEY') ready = true
      else if (ping.json?.code === 'UNAUTHORIZED_INVALID_JWT_FORMAT') {
        skipReason = 'gateway verify_jwt blocks raw rc_ keys — serve api with --no-verify-jwt to run this suite'
      }
    } catch { /* not up yet */ }
    if (!ready && !skipReason) await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) {
    if (!skipReason) skipReason = `api edge function not reachable at ${API_BASE}`
    return
  }

  A = await createUserWithKey('a')
  B = await createUserWithKey('b')

  const tmpl = await api(A.key, 'POST', '/templates', {
    name: `T-${randomUUID().slice(0, 6)}`,
    fields: [{ key: 'field_1', name: 'Front', type: 'text', order: 0 }, { key: 'field_2', name: 'Back', type: 'text', order: 1 }],
    front_layout: [{ field_key: 'field_1', style: 'primary' }],
    back_layout: [{ field_key: 'field_2', style: 'primary' }],
  })
  if (tmpl.status !== 201) throw new Error('seed template failed: ' + JSON.stringify(tmpl.json))
  aTemplateId = tmpl.json.data.id

  const deck = await api(A.key, 'POST', '/decks', { name: `D-${randomUUID().slice(0, 6)}`, default_template_id: aTemplateId })
  if (deck.status !== 201) throw new Error('seed deck failed: ' + JSON.stringify(deck.json))
  aDeckId = deck.json.data.id

  const cards = await api(A.key, 'POST', `/decks/${aDeckId}/cards`, [{ template_id: aTemplateId, field_values: { field_1: 'hi', field_2: 'bye' } }])
  if (cards.status !== 201) throw new Error('seed cards failed: ' + JSON.stringify(cards.json))
  aCardId = cards.json.data[0].id

  const listing = await api(A.key, 'POST', '/marketplace', { deck_id: aDeckId, title: `L-${randomUUID().slice(0, 6)}`, description: 'x', share_mode: 'copy' })
  if (listing.status === 201) aListingId = listing.json.data.id

  const share = await api(A.key, 'POST', '/shares', { deck_id: aDeckId, share_mode: 'copy', is_readonly: false })
  if (share.status === 201) aShareId = share.json.data.id
}, 90_000)

describe('REST API cross-tenant authorization (H4)', () => {
  itLocal('positive control: A reads its own deck + card', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(A.key, 'GET', `/decks/${aDeckId}`)).status).toBe(200)
    expect((await api(A.key, 'GET', `/cards/${aCardId}`)).status).toBe(200)
  })

  itLocal('B cannot read A\'s deck / cards / card', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(B.key, 'GET', `/decks/${aDeckId}`)).status).toBe(404)
    expect((await api(B.key, 'GET', `/decks/${aDeckId}/cards`)).status).toBe(404)
    expect((await api(B.key, 'GET', `/cards/${aCardId}`)).status).toBe(404)
  })

  itLocal('B cannot delete A\'s card (and it survives)', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(B.key, 'DELETE', `/cards/${aCardId}`)).status).toBe(404)
    expect((await api(A.key, 'GET', `/cards/${aCardId}`)).status).toBe(200)
  })

  itLocal('B cannot read / modify / delete A\'s template', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(B.key, 'GET', `/templates/${aTemplateId}`)).status).toBe(404)
    expect((await api(B.key, 'PATCH', `/templates/${aTemplateId}`, { name: 'hacked' })).status).toBe(404)
    expect((await api(B.key, 'DELETE', `/templates/${aTemplateId}`)).status).toBe(404)
    const t = await api(A.key, 'GET', `/templates/${aTemplateId}`)
    expect(t.status).toBe(200)
    expect(t.json.data.name).not.toBe('hacked')
  })

  itLocal('B cannot reference A\'s template or deck in writes', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(B.key, 'POST', '/decks', { name: 'x', default_template_id: aTemplateId })).status).toBe(404)
    expect((await api(B.key, 'POST', `/decks/${aDeckId}/cards`, [{ template_id: aTemplateId, field_values: { field_1: 'x' } }])).status).toBe(404)
  })

  itLocal('B cannot publish A\'s deck to marketplace', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    expect((await api(B.key, 'POST', '/marketplace', { deck_id: aDeckId, title: 'steal', description: 'x', share_mode: 'copy' })).status).toBe(404)
  })

  itLocal('B cannot delete A\'s marketplace listing', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    if (!aListingId) return
    expect((await api(B.key, 'DELETE', `/marketplace/${aListingId}`)).status).toBe(404)
    expect((await api(A.key, 'GET', `/marketplace/${aListingId}`)).status).toBe(200)
  })

  itLocal('B cannot revoke A\'s share', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    if (!aShareId) return
    expect((await api(B.key, 'DELETE', `/shares/${aShareId}`)).status).toBe(404)
  })

  itLocal('B sees none of A\'s resources in its own lists', async (ctx) => {
    if (!ready) return ctx.skip(skipReason || 'api edge function not reachable')
    const decks = await api(B.key, 'GET', '/decks')
    expect(decks.status).toBe(200)
    expect((decks.json.data as any[]).some((d) => d.id === aDeckId)).toBe(false)
    const tmpls = await api(B.key, 'GET', '/templates')
    expect((tmpls.json.data as any[]).some((t) => t.id === aTemplateId)).toBe(false)
  })
})
