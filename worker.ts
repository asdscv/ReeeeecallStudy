// Cloudflare Worker — API 프록시 + SPA fallback
const SUPABASE_FN = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api/v1'

interface Env {
  ASSETS: Fetcher
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // OPTIONS preflight
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/v1/')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // /api/v1/* → Supabase Edge Function 프록시
    if (url.pathname.startsWith('/api/v1/')) {
      const subpath = url.pathname.slice('/api/v1/'.length)
      const target = `${SUPABASE_FN}/${subpath}${url.search}`

      const headers = new Headers(request.headers)
      headers.delete('host')

      const res = await fetch(target, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? request.body
          : undefined,
      })

      const responseHeaders = new Headers(res.headers)
      responseHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      })
    }

    // 정적 에셋 시도 → 404면 index.html (SPA fallback)
    const assetRes = await env.ASSETS.fetch(request)
    if (assetRes.status === 404) {
      const indexReq = new Request(new URL('/', url).toString(), request)
      return env.ASSETS.fetch(indexReq)
    }
    return assetRes
  },
}
