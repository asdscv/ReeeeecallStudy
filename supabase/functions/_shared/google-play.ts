// Google Play Developer API helpers — the ONLY store refund we can issue ourselves.
//
// WHY THIS EXISTS. Mobile purchases arrive through RevenueCat under one provider
// ('revenuecat'), but the two stores behind it are not symmetric:
//   * Google Play  — the Developer API lets the DEVELOPER issue a refund + revoke.
//   * Apple App Store — no developer refund API exists, at all. Apple decides.
// So an admin "refund" on Android can move real money exactly like the web
// providers do, while on iOS it can only revoke access. This module is the Android
// half; iOS deliberately has no counterpart (see admin-refund's ios branch).
//
// AUTH: a Google Cloud SERVICE ACCOUNT, not an API key. We sign a JWT with the
// account's private key, exchange it at Google's token endpoint for a short-lived
// OAuth2 access token, and call androidpublisher with it. There is no SDK in the
// Deno edge runtime, so the RS256 signing is done with Web Crypto below.
//
// ── OWNER GO-LIVE SETUP ──
//   Google Cloud console (the project linked to Play Console):
//     IAM & Admin → Service Accounts → create one → Keys → Add key → JSON.
//   Play Console → Users and permissions → Invite the service-account email →
//     grant "View financial data, orders, and cancellation survey responses" AND
//     "Manage orders and subscriptions". Without BOTH, orders.refund returns 401.
//   Supabase → Edge Functions → Secrets:
//     GOOGLE_PLAY_SERVICE_ACCOUNT  — the whole downloaded JSON, pasted verbatim
//     GOOGLE_PLAY_PACKAGE_NAME     — defaults to com.reeeeecall.study if unset
//   NOTE: Play grants can take up to 24h to propagate to the API.
//
// FAIL-CLOSED: with GOOGLE_PLAY_SERVICE_ACCOUNT unset every entry point here
// reports notConfigured, and the caller must return 503 rather than pretend a
// refund happened. Never report a money movement we did not make.

const ANDROID_PUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

export const DEFAULT_PACKAGE_NAME = 'com.reeeeecall.study'

export interface PlayResult {
  ok: boolean
  status: number
  body: unknown
  /** true when the secret is missing — the caller must 503, never claim success. */
  notConfigured?: boolean
}

interface ServiceAccount {
  client_email: string
  private_key: string
}

function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (typeof o?.client_email === 'string' && typeof o?.private_key === 'string') {
      return { client_email: o.client_email, private_key: o.private_key }
    }
  } catch { /* malformed JSON → treated as unconfigured (fail-closed) */ }
  return null
}

// base64url without padding — what JWS requires.
function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string'
    ? bytes
    : Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// PEM (PKCS#8, as Google issues it) → DER bytes for crypto.subtle.importKey.
// The JSON field carries literal "\n" escapes when it round-trips through env vars,
// so normalise those before stripping the armour.
// Returns a plain ArrayBuffer (not a Uint8Array view) because importKey's BufferSource
// overload rejects a view whose backing buffer could be a SharedArrayBuffer.
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new ArrayBuffer(bin.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return buf
}

// Exchange the service account for a short-lived access token (RFC 7523 flow).
// Not cached: an admin refund is a rare, human-initiated action, so a fresh token
// per call is simpler and avoids holding credentials in module state.
async function getAccessToken(sa: ServiceAccount, nowSec: number): Promise<string | null> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: nowSec,
    exp: nowSec + 3600,
  }))
  const signingInput = `${header}.${claims}`

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch (e) {
    console.error('[google-play] private_key is not importable PKCS#8:', (e as Error)?.message)
    return null
  }

  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)),
  )
  const assertion = `${signingInput}.${b64url(sig)}`

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const body = await resp.json().catch(() => null)
  if (!resp.ok || typeof body?.access_token !== 'string') {
    console.error('[google-play] token exchange failed:', resp.status, JSON.stringify(body))
    return null
  }
  return body.access_token
}

/**
 * Refund a Play order, optionally revoking entitlement at the same time.
 *
 * `orderId` is the Play order id (GPA.xxxx-xxxx-xxxx-xxxxx). RevenueCat surfaces it
 * as the transaction id on Play events, which is what we persist as the
 * subscription / credit-grant key — so the admin path already holds it.
 *
 * orders.refund covers BOTH product types: a consumable credit pack and a
 * subscription. `revoke=true` additionally cancels the subscription and drops the
 * entitlement immediately, which is what we want for an admin refund — otherwise
 * Play would keep renewing a subscription whose money we just returned while our
 * own terminal-state guard refuses to re-entitle it (charged, no access).
 *
 * IDEMPOTENCY: a second refund of the same order returns 400 with
 * "order is not refundable" / already-refunded; `alreadyRefunded()` below matches
 * that precisely so a redelivery is not reported as a failure — and nothing looser,
 * so a genuine rejection is never swallowed as success.
 */
export async function playRefundOrder(
  serviceAccountJson: string | undefined,
  packageName: string,
  orderId: string,
  opts: { revoke: boolean; nowSec: number },
): Promise<PlayResult> {
  const sa = parseServiceAccount(serviceAccountJson)
  if (!sa) return { ok: false, status: 0, body: null, notConfigured: true }

  const token = await getAccessToken(sa, opts.nowSec)
  if (!token) {
    return { ok: false, status: 401, body: { error: 'service_account_auth_failed' } }
  }

  const url = `${ANDROID_PUBLISHER}/applications/${encodeURIComponent(packageName)}` +
    `/orders/${encodeURIComponent(orderId)}:refund?revoke=${opts.revoke ? 'true' : 'false'}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  // A successful refund returns 204 with an EMPTY body — .json() would throw.
  const text = await resp.text().catch(() => '')
  let body: unknown = text
  if (text) { try { body = JSON.parse(text) } catch { /* keep the raw text */ } }
  return { ok: resp.ok, status: resp.status, body }
}

/**
 * True only on Play's explicit already-refunded / not-refundable signal.
 *
 * Deliberately narrow, mirroring the LemonSqueezy guard in admin-refund: a bare
 * mention of "refund" in an error message could be an eligibility or validation
 * complaint, and treating that as "already done" would report a refund that never
 * happened.
 */
export function playAlreadyRefunded(r: PlayResult): boolean {
  const s = JSON.stringify(r.body ?? '')
  return /already[^"]*refunded|not\s+refundable|has\s+been\s+refunded/i.test(s)
}
