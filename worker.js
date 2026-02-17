// Cloudflare Worker — API 프록시 + SPA fallback
const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // /api/* → Supabase Edge Function 프록시 (v1 엔드포인트 + doc/ui)
    if (url.pathname.startsWith('/api/')) {
      // OPTIONS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        })
      }

      const subpath = url.pathname.slice('/api/'.length)
      const target = `${SUPABASE_BASE}/${subpath}${url.search}`

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

    // 정적 에셋은 assets 바인딩이 자동 처리 (wrangler.jsonc의 assets 설정)
    return new Response('Not Found', { status: 404 })
  },
}
