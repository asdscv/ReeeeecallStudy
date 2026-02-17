// Cloudflare Pages Function — API 프록시
// /api/v1/* → Supabase Edge Function
const SUPABASE_FUNCTION_URL = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api/v1'

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url)
  const path = context.params.path
  const subpath = Array.isArray(path) ? path.join('/') : (path || '')
  const target = `${SUPABASE_FUNCTION_URL}/${subpath}${url.search}`

  const headers = new Headers(context.request.headers)
  headers.delete('host')

  const response = await fetch(target, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  })

  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('Access-Control-Allow-Origin', '*')
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  responseHeaders.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
