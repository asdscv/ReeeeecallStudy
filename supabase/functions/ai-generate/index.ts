// Server-side AI flashcard generation (Phase 0).
//
// Replaces client-side BYOK: the SERVER holds the provider key, meters a
// per-account daily free quota (record_ai_generation), and BUILDS THE PROMPT
// server-side from structured params — clients never send raw prompt text, so
// our key can't be turned into a free general-purpose LLM (prompt-injection /
// proxy abuse). Mirrors the `tts` edge function (JWT auth → metering RPC →
// provider call → respond).
//
// POST /ai-generate
//   body: { kind: 'template'|'deck'|'cards', topic, uiLang, ...kind-specific }
//   200 : { content: <parsed JSON>, remainingFree: number }
//   401 unauth · 400 bad request · 429 quota · 502 provider · 503 not configured

import { createClient } from '@supabase/supabase-js'
import {
  buildTemplatePrompt,
  buildDeckPrompt,
  buildCardsPrompt,
  type FieldHint,
  type GeneratedTemplateField,
} from '../_shared/ai-prompts.ts'
import { resolveModel, type ResolvedModel } from '../_shared/ai-providers.ts'

// Provider + model are resolved per request from the registry (env-driven) —
// see _shared/ai-providers.ts. Switching provider/model needs no code change.
const ENV = (k: string) => Deno.env.get(k)

// ── Limits ──────────────────────────────────────────────────
const MAX_TOPIC_LEN = 2000
const MAX_FIELDS = 12
const MAX_CARDS_PER_CALL = 25 // matches the client batch size
const MAX_EXISTING_CARDS = 50
const MAX_FIELD_STR = 200                  // cap field key/name/hint length (L2)
const MAX_EXISTING_CARDS_BYTES = 8000      // cap dedup payload size (L2)
const PROVIDER_RETRY_DELAYS = [2000, 8000] // ms; per-minute provider rate limits
const PROVIDER_TIMEOUT_MS = 30000          // abort a hung provider call (L1)

// ── CORS (origin allowlist; mirror tts) ─────────────────────
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
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

// ── Auth (mirror tts) ───────────────────────────────────────
async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user?.id ?? null
}

// ── Provider call (port base-openai retry + callAI json-retry) ──
function stripMarkdownFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return cleaned.trim()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function providerRequest(m: ResolvedModel, systemPrompt: string, userPrompt: string): Promise<string> {
  const body = {
    model: m.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: 16384,
  }

  for (let attempt = 0; attempt <= PROVIDER_RETRY_DELAYS.length; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${m.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch {
      // network error or timeout(abort) — retry within budget, then fail.
      if (attempt < PROVIDER_RETRY_DELAYS.length) { await sleep(PROVIDER_RETRY_DELAYS[attempt]); continue }
      throw new Error('PROVIDER_ERROR')
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 401 || res.status === 403) throw new Error('PROVIDER_AUTH')
    if ((res.status === 429 || res.status >= 500) && attempt < PROVIDER_RETRY_DELAYS.length) {
      await sleep(PROVIDER_RETRY_DELAYS[attempt])
      continue
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[ai-generate] provider ${res.status}: ${errBody.slice(0, 300)}`)
      throw new Error('PROVIDER_ERROR')
    }

    const data = await res.json() as Record<string, any>
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('PROVIDER_EMPTY')
    return content as string
  }
  throw new Error('PROVIDER_ERROR')
}

// Returns parsed JSON; one stricter-prompt retry on unparseable output (mirrors callAI).
async function generate(m: ResolvedModel, systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> {
  const first = stripMarkdownFences(await providerRequest(m, systemPrompt, userPrompt))
  try {
    return JSON.parse(first)
  } catch {
    const strict = systemPrompt +
      '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation, just pure JSON.'
    const retry = stripMarkdownFences(await providerRequest(m, strict, userPrompt))
    return JSON.parse(retry)
  }
}

// ── Request validation ──────────────────────────────────────
function asTopic(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.length > MAX_TOPIC_LEN) return null
  return t
}

function asFields(v: unknown): GeneratedTemplateField[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FIELDS) return null
  const out: GeneratedTemplateField[] = []
  for (const f of v) {
    if (!f || typeof f.key !== 'string' || typeof f.name !== 'string') return null
    if (f.key.length > MAX_FIELD_STR || f.name.length > MAX_FIELD_STR) return null
    out.push({
      key: f.key,
      name: f.name,
      type: 'text',
      order: typeof f.order === 'number' ? f.order : 0,
      tts_enabled: f.tts_enabled,
      tts_lang: typeof f.tts_lang === 'string' ? f.tts_lang : undefined,
    })
  }
  return out
}

// Validate field hints (L3) — reject malformed instead of casting (→ 500).
// Returns undefined when absent, null when invalid.
function asFieldHints(v: unknown): FieldHint[] | null | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > MAX_FIELDS) return null
  const out: FieldHint[] = []
  for (const h of v) {
    if (!h || typeof h.name !== 'string' || h.name.length > MAX_FIELD_STR) return null
    if (h.side !== 'front' && h.side !== 'back') return null
    out.push({ name: h.name, side: h.side, ttsLang: typeof h.ttsLang === 'string' ? h.ttsLang : undefined })
  }
  return out
}

// Validate the existing-cards dedup payload (L2) — flat string maps, size-capped.
function asExistingCards(v: unknown): Record<string, string>[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Record<string, string>[] = []
  for (const c of v.slice(0, MAX_EXISTING_CARDS)) {
    if (!c || typeof c !== 'object') continue
    const rec: Record<string, string> = {}
    for (const [k, val] of Object.entries(c as Record<string, unknown>)) {
      if (typeof val === 'string') rec[k] = val
    }
    out.push(rec)
  }
  if (JSON.stringify(out).length > MAX_EXISTING_CARDS_BYTES) return undefined
  return out.length > 0 ? out : undefined
}

// ── Handler ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = corsHeadersFor(req.headers.get('Origin'))

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  try {
    const authHeader = req.headers.get('Authorization')
    const userId = await verifyUser(authHeader)
    if (!userId) return json({ error: 'Unauthorized' }, 401, cors)

    const model = resolveModel('text', ENV)
    if (!model) {
      console.error('[ai-generate] no provider configured (set AI_GENERATION_PROVIDER_KEY)')
      return json({ error: 'Server not configured', code: 'AI_NOT_CONFIGURED' }, 503, cors)
    }

    const body = await req.json().catch(() => null) as Record<string, any> | null
    if (!body) return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400, cors)

    const kind = body.kind
    if (kind !== 'template' && kind !== 'deck' && kind !== 'cards') {
      return json({ error: 'Invalid kind', code: 'BAD_REQUEST' }, 400, cors)
    }
    const topic = asTopic(body.topic)
    if (!topic) return json({ error: 'Invalid topic', code: 'BAD_REQUEST' }, 400, cors)
    const uiLang = typeof body.uiLang === 'string' ? body.uiLang : 'en'

    // Build the prompt server-side from structured params; compute card count.
    let systemPrompt: string
    let userPrompt: string
    let pCards = 0

    if (kind === 'template') {
      const hints = asFieldHints(body.fieldHints)
      if (hints === null) return json({ error: 'Invalid fieldHints', code: 'BAD_REQUEST' }, 400, cors)
      ;({ systemPrompt, userPrompt } = buildTemplatePrompt(
        topic, uiLang, !!body.useCustomHtml,
        typeof body.contentLang === 'string' && body.contentLang ? body.contentLang : undefined,
        hints,
      ))
    } else if (kind === 'deck') {
      ;({ systemPrompt, userPrompt } = buildDeckPrompt(topic, uiLang))
    } else {
      const fields = asFields(body.fields)
      if (!fields) return json({ error: 'Invalid fields', code: 'BAD_REQUEST' }, 400, cors)
      const reqCount = Number(body.cardCount)
      if (!Number.isFinite(reqCount) || reqCount < 1) {
        return json({ error: 'Invalid cardCount', code: 'BAD_REQUEST' }, 400, cors)
      }
      pCards = Math.min(MAX_CARDS_PER_CALL, Math.floor(reqCount))
      const existing = asExistingCards(body.existingCards)
      ;({ systemPrompt, userPrompt } = buildCardsPrompt(topic, fields, pCards, existing))
    }

    // Meter BEFORE generation (gate cost). Runs as the caller so auth.uid()
    // resolves; RAISE → error, rolled back so a rejected call consumes nothing.
    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } },
    )
    const { data: remainingFree, error: quotaErr } = await sbUser.rpc('record_ai_generation', {
      p_kind: kind,
      p_cards: pCards,
    })
    if (quotaErr) {
      // P0002 = over free allowance AND not enough credits → needs top-up.
      if (quotaErr.code === 'P0002') {
        return json({ error: 'Insufficient AI credits', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
      }
      // 23514 = daily request cap (abuse guard).
      if (quotaErr.code === '23514') {
        return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
      }
      console.error('[ai-generate] metering error:', quotaErr.message)
      return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
    }

    // Generate.
    let content: Record<string, unknown>
    try {
      content = await generate(model, systemPrompt, userPrompt)
    } catch (e) {
      const msg = (e as Error).message
      console.error('[ai-generate] provider failure:', msg)
      // M1: metering already committed — refund the cards so a provider failure
      // doesn't burn the user's free quota. Best-effort (don't mask the 502).
      if (pCards > 0) {
        await sbUser.rpc('refund_ai_generation', { p_cards: pCards }).catch(() => {})
      }
      const code = msg === 'PROVIDER_AUTH' ? 'AI_PROVIDER_AUTH' : 'AI_PROVIDER_ERROR'
      return json({ error: 'Generation failed', code }, 502, cors)
    }

    return json({ content, remainingFree }, 200, cors)
  } catch (err) {
    console.error('[ai-generate] Error:', err)
    return json({ error: 'Generation failed', code: 'INTERNAL' }, 500, cors)
  }
})
