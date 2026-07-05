// Subscription customer-portal link — on-demand.
//
// LemonSqueezy is a Merchant of Record, so subscription management (cancel, upgrade/
// DOWNGRADE the plan, update the card, resume) happens in LS's hosted CUSTOMER PORTAL,
// and the resulting subscription_updated / subscription_cancelled webhooks flow back
// through `lemonsqueezy-webhook` → sync_subscription to keep our billing_subscriptions
// (and the card limit) in sync. We never mutate the subscription ourselves.
//
// This fn returns a FRESH signed portal URL for the caller's own subscription:
//   POST /subscription-portal
//   200 { url }              → open in a new tab
//   404 { code:'NO_SUBSCRIPTION' } when the caller has no LS subscription
//   401 unauth · 503 not configured (LEMONSQUEEZY_API_KEY unset) · 502 LS error
//
// The signed portal URL expires, so it is fetched per request (GET /v1/subscriptions/
// <id> → data.attributes.urls.customer_portal), never stored.
//
// Deploy: no [functions.subscription-portal] block → default verify_jwt = true (a
// valid user JWT is required); we also re-derive the user id from it. Needs the
// LEMONSQUEEZY_API_KEY secret (a LemonSqueezy API key, Settings → API).

import { createClient } from '@supabase/supabase-js'

const ENV = (k: string) => Deno.env.get(k)

const ALLOWED_ORIGINS = (ENV('ALLOWED_ORIGINS') ??
  'https://reeeeecallstudy.xyz,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean)

function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Verify the caller's JWT (mirror ai-generate/tts) → their user id, or null.
async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_ANON_KEY')!)
  const { data: { user } } = await sb.auth.getUser(token)
  return user?.id ?? null
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const userId = await verifyUser(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401, cors)

  const apiKey = ENV('LEMONSQUEEZY_API_KEY')
  if (!apiKey) return json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 503, cors)

  // The caller's most recent LemonSqueezy subscription that has a provider id (any
  // status — a canceled-at-period-end sub may want to RESUME/change in the portal).
  const svc = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: sub, error: subErr } = await svc
    .from('billing_subscriptions')
    .select('provider_subscription_id')
    .eq('user_id', userId)
    .eq('provider', 'lemonsqueezy')
    .not('provider_subscription_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (subErr) {
    console.error('[subscription-portal] sub lookup failed:', subErr.message)
    return json({ error: 'Lookup failed' }, 500, cors)
  }
  const subId = (sub as { provider_subscription_id?: string } | null)?.provider_subscription_id
  if (!subId) return json({ error: 'No subscription', code: 'NO_SUBSCRIPTION' }, 404, cors)

  // Fetch a fresh signed customer-portal URL from LemonSqueezy.
  let resp: Response
  try {
    resp = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json' },
    })
  } catch (e) {
    console.error('[subscription-portal] LS fetch threw:', e)
    return json({ error: 'Provider unreachable' }, 502, cors)
  }
  if (!resp.ok) {
    console.error('[subscription-portal] LS returned', resp.status)
    return json({ error: 'Provider error' }, 502, cors)
  }
  const body = await resp.json().catch(() => null) as
    | { data?: { attributes?: { urls?: { customer_portal?: string } } } }
    | null
  const url = body?.data?.attributes?.urls?.customer_portal
  if (!url) return json({ error: 'No portal url' }, 502, cors)

  return json({ url }, 200, cors)
})
