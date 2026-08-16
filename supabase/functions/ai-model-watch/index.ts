// Watch every provider's model list, and say what is new.
//
// Three times a model has moved under this app and it found out the expensive way: two Gemini
// models answered 404 "no longer available" while still sitting ahead of a working one in the
// fallback chain, `gemini-2.5-flash-lite` was quietly cut to twenty requests a day while it was
// the PRIMARY, and `deepseek-chat` stayed in the provider table for months after the API stopped
// listing it. Each was discovered by a learner hitting an error.
//
// A provider's model list is one HTTP call and it is authoritative. This calls it, hands the
// result to `record_ai_models`, and returns the diff. The DIFF is the notification: what to do
// about it belongs to whoever reads it, which is a scheduled GitHub Action.
//
// Service-role only. It reads nothing about any learner and writes nothing they can see.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { PROVIDERS } from '../_shared/ai-providers.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** Which providers to poll, and the key each one needs. Text and vision may differ. */
function watchTargets(): Array<{ provider: string; apiKey: string; baseUrl: string }> {
  const env = (k: string) => Deno.env.get(k) ?? ''
  const seen = new Map<string, { provider: string; apiKey: string; baseUrl: string }>()

  const add = (provider: string, apiKey: string) => {
    const def = PROVIDERS[provider.trim()]
    if (!def || !apiKey.trim() || seen.has(provider)) return
    seen.set(provider, { provider, apiKey: apiKey.trim(), baseUrl: def.baseUrl })
  }
  add(env('AI_GENERATION_PROVIDER') || 'gemini', env('AI_GENERATION_PROVIDER_KEY'))
  add(env('AI_VISION_PROVIDER') || env('AI_GENERATION_PROVIDER') || 'gemini',
      env('AI_VISION_PROVIDER_KEY') || env('AI_GENERATION_PROVIDER_KEY'))
  return [...seen.values()]
}

/**
 * A provider's model ids.
 *
 * Both providers speak the OpenAI `GET /models` shape. Gemini prefixes ids with `models/`, which
 * is not what anyone types into `AI_GENERATION_MODEL` — stripping it here keeps the table
 * comparable with the provider registry and with what a human would write.
 */
async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  const body = await res.json() as { data?: Array<{ id?: unknown }> }
  return (body.data ?? [])
    .map((m) => (typeof m.id === 'string' ? m.id.replace(/^models\//, '') : ''))
    .filter(Boolean)
}

/** Constant-time string compare. Equal lengths are checked by the caller. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // The DATABASE decides who may do this, not a string comparison here.
  //
  // Comparing the header against `SUPABASE_SERVICE_ROLE_KEY` rejected a perfectly valid caller:
  // a project has more than one service credential — the legacy JWT and the newer `sb_secret_…`
  // form — and only one of them is in that variable. So the caller's own token builds the client
  // and `record_ai_models` applies its `auth.role() = 'service_role'` check, which is the same
  // rule stated once, in the place that owns the table.
  //
  // A SECOND door, for the scheduler: `x-watch-token`.
  //
  // The daily run lives in GitHub Actions, and the only credential that could open the first door
  // is a service-role key — the highest-privilege secret the project has, for a job whose entire
  // power is "ask two vendors what models they sell". A leaked key there is a database; a leaked
  // token here is a wasted HTTP request. So the scheduler gets a purpose-built secret and the
  // function supplies the service role itself, from an environment variable that never leaves
  // Supabase.
  //
  // Constant-time compare, because this is a shared secret checked against a header and the
  // difference between a fast reject and a slow one is a character-by-character oracle.
  const watchToken = (Deno.env.get('MODEL_WATCH_TOKEN') ?? '').trim()
  const offered = (req.headers.get('x-watch-token') ?? '').trim()
  const viaToken = watchToken.length >= 16 && offered.length === watchToken.length
    && timingSafeEqual(offered, watchToken)

  const auth = req.headers.get('Authorization') ?? ''
  if (!viaToken && !auth.startsWith('Bearer ')) {
    return json({ error: 'Service role or watch token required' }, 403)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    viaToken
      ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      : auth.slice('Bearer '.length),
    { auth: { persistSession: false } },
  )

  const found: Record<string, string[]> = {}
  const added: Array<{ provider: string; model: string }> = []
  const failures: Array<{ provider: string; error: string }> = []

  for (const target of watchTargets()) {
    try {
      const models = await listModels(target.baseUrl, target.apiKey)
      // An empty list is a failed fetch dressed as a success; `record_ai_models` refuses it, and
      // this refuses to even ask, so one provider's outage cannot retire its whole catalogue.
      if (!models.length) throw new Error('empty model list')
      found[target.provider] = models

      const { data, error } = await supabase.rpc('record_ai_models', {
        p_provider: target.provider, p_models: models,
      })
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as Array<{ new_model: string }>) {
        added.push({ provider: target.provider, model: row.new_model })
      }
    } catch (e) {
      // One provider failing must not stop the others being checked — a Gemini outage should
      // not blind us to a DeepSeek release.
      failures.push({ provider: target.provider, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const { data: pending, error: pendingError } = await supabase.rpc('unacknowledged_ai_models')
  // A caller without the service role gets here having recorded nothing, and this is where it
  // shows: say so plainly rather than returning an empty, successful-looking report.
  if (pendingError) return json({ error: pendingError.message }, 403)

  return json({
    checked: Object.fromEntries(Object.entries(found).map(([p, m]) => [p, m.length])),
    added,
    // Everything nobody has looked at yet, not just today's additions: a run that adds nothing
    // should still report a model that appeared last week and was never triaged.
    unacknowledged: pending ?? [],
    failures,
  }, failures.length && !Object.keys(found).length ? 502 : 200)
})
