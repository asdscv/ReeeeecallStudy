// Server-side LemonSqueezy checkout creation (JWT-authed).
//
// WHY THIS EXISTS: this store's STATIC buy links (/checkout/buy/<variant-slug>)
// render in TEST mode even though the store is fully live (Setup complete, test
// mode off) — a LemonSqueezy static-buy-link quirk. Only checkouts created via the
// API with `test_mode:false` render LIVE. So instead of the client redirecting to a
// static buy link (LemonsqueezyProvider's original behaviour), it calls THIS function;
// the server (which holds the secret LS API key) creates a live checkout and returns
// its hosted URL. The buyer's server-issued merchant_uid rides in checkout_data.custom
// so the `lemonsqueezy-webhook` reconciles the grant EXACTLY as before — the money path
// (create_payment_intent → webhook → confirm_payment / activate_subscription) is
// unchanged; only the checkout URL's origin moves from a static link to an API object.
//
// POST /lemonsqueezy-checkout   (JWT-authed; verify_jwt default = true)
//   body: { merchant_uid }
//   200 : { url }
//   400 bad request · 401 unauth · 403 not your intent · 404 unknown intent /
//   unmapped product · 502 LS error · 503 not configured
//
// SECURITY: the caller must own the intent named by merchant_uid (guards against a
// user minting a checkout against someone else's intent). Price + product stay server
// authoritative on the intent; this fn only picks the right VARIANT for that product
// from LEMONSQUEEZY_VARIANT_MAP and never sets a price (the LS variant carries it).

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
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Resolve the caller from the bearer JWT. Returns { id, email } or null.
async function verifyUser(authHeader: string | null): Promise<{ id: string; email: string | null } | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_ANON_KEY')!)
  const { data: { user } } = await sb.auth.getUser(token)
  if (!user) return null
  return { id: user.id, email: user.email ?? null }
}

// Invert LEMONSQUEEZY_VARIANT_MAP ({"<variant id>":"<product id>"}) → product_id → variant_id.
// Returns null when unset/malformed so the fn fails closed (never mints a wrong checkout).
function productToVariant(): Record<string, string> | null {
  const raw = ENV('LEMONSQUEEZY_VARIANT_MAP')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: Record<string, string> = {}
    for (const [variantId, productId] of Object.entries(parsed as Record<string, unknown>)) {
      if (productId != null && productId !== '') out[String(productId)] = String(variantId)
    }
    return out
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeadersFor(origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  const apiKey = ENV('LEMONSQUEEZY_API_KEY')
  const storeId = ENV('LEMONSQUEEZY_STORE_ID')
  if (!apiKey || !storeId) {
    console.error('[lemonsqueezy-checkout] LEMONSQUEEZY_API_KEY / LEMONSQUEEZY_STORE_ID unset')
    return json({ error: 'Checkout not configured', code: 'NOT_CONFIGURED' }, 503, cors)
  }

  const user = await verifyUser(req.headers.get('Authorization'))
  if (!user) return json({ error: 'Unauthorized' }, 401, cors)

  const body = await req.json().catch(() => null) as { merchant_uid?: unknown } | null
  const merchantUid = body && typeof body.merchant_uid === 'string' ? body.merchant_uid : ''
  if (!merchantUid) return json({ error: 'Missing merchant_uid', code: 'BAD_REQUEST' }, 400, cors)

  // Look up the server-authoritative intent (service role bypasses RLS) and assert the
  // caller owns it — a checkout may only be minted for the requester's own intent.
  const sb = createClient(ENV('SUPABASE_URL')!, ENV('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: intent, error: lookupErr } = await sb
    .from('payment_intents')
    .select('product_id, user_id, status')
    .eq('merchant_uid', merchantUid)
    .maybeSingle()
  if (lookupErr) {
    console.error('[lemonsqueezy-checkout] intent lookup failed:', lookupErr.message)
    return json({ error: 'Lookup failed', code: 'LOOKUP_ERROR' }, 500, cors)
  }
  if (!intent) return json({ error: 'Unknown intent', code: 'NOT_FOUND' }, 404, cors)
  if (intent.user_id !== user.id) {
    console.error('[lemonsqueezy-checkout] intent', merchantUid, 'not owned by caller')
    return json({ error: 'Not your intent', code: 'FORBIDDEN' }, 403, cors)
  }

  const variantMap = productToVariant()
  const variantId = variantMap ? variantMap[intent.product_id] : undefined
  if (!variantId) {
    console.error('[lemonsqueezy-checkout] no variant mapped for product', intent.product_id,
      '(set LEMONSQUEEZY_VARIANT_MAP)')
    return json({ error: 'Product not purchasable', code: 'UNMAPPED_PRODUCT' }, 500, cors)
  }

  const appOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

  // Create a LIVE (test_mode:false) hosted checkout for the mapped variant, tagging the
  // buyer's merchant_uid into custom data so the webhook reconciles the grant.
  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        test_mode: false,
        checkout_data: {
          email: user.email ?? undefined,
          custom: { merchant_uid: merchantUid },
        },
        product_options: {
          redirect_url: `${appOrigin}/settings?pay=success`,
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(storeId) } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  }

  let lsResp: Response
  try {
    lsResp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('[lemonsqueezy-checkout] LS request threw:', e)
    return json({ error: 'Checkout provider unreachable', code: 'LS_UNREACHABLE' }, 502, cors)
  }

  const lsBody = await lsResp.json().catch(() => null) as
    | { data?: { attributes?: { url?: string } }; errors?: unknown }
    | null
  const url = lsBody?.data?.attributes?.url
  if (!lsResp.ok || !url) {
    console.error('[lemonsqueezy-checkout] LS create failed', lsResp.status, JSON.stringify(lsBody)?.slice(0, 400))
    return json({ error: 'Could not create checkout', code: 'LS_ERROR' }, 502, cors)
  }

  return json({ url }, 200, cors)
})
