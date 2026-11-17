/** Document HTTP requests are a separate metric from browser views/read events. */
export async function observeTraffic(request, response, env) {
  const url = new URL(request.url)
  if (request.method !== 'GET' || !response.headers.get('content-type')?.includes('text/html')
    || /^\/(admin|auth)(\/|$)/.test(url.pathname)) return
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1'
    || /(?:^|;\s*)reklue_analytics_opt_out=1(?:;|$)/.test(request.headers.get('cookie') || '')) return
  const cf = request.cf || {}
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_traffic_request`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_payload: {
      hostname: url.hostname,
      page_path: url.pathname,
      user_agent: (request.headers.get('user-agent') || '').slice(0, 500),
      referrer: safeReferrer(request.headers.get('referer')),
      country: cf.country || null,
      asn: cf.asn || null,
      verified_bot: cf.botManagement?.verifiedBot ?? null,
      response_status: response.status,
    } }),
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`traffic_observation_failed:${res.status}`)
}

function safeReferrer(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null
  } catch { return null }
}
