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
//   body: { kind: 'template'|'deck'|'cards'|'image', topic|image, uiLang, ...kind-specific }
//   200 : { content: <parsed JSON>, remainingFree?: number, balance?: number }
//   401 unauth · 400 bad request · 429 quota · 502 provider · 503 not configured

import { createClient } from '@supabase/supabase-js'
import {
  buildTemplatePrompt,
  buildDeckPrompt,
  buildCardsPrompt,
  buildImageCardsPrompt,
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
const MAX_IMAGE_BYTES = 7_000_000          // ~5MB image as a base64 data URL (vision)

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

// Service-role client — used ONLY for the privileged post-gen charge
// (charge_ai_generation) and failure release (release_ai_job), both service_role-gated.
function sbServiceRole() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// Release a RESERVED job when generation FAILS (metered billing, mig 114). Nothing
// was deducted pre-gen (charge is post-gen only), so this only reverses the
// free/paid/image day counters — no wallet touch → the failure is net-zero. NOTE:
// supabase-js's rpc() is a thenable with NO `.catch` (`.rpc().catch()` throws
// "catch is not a function"), so await it and inspect the RETURNED error, wrapped
// for the network throw. Best-effort — must never mask the caller's 502.
async function releaseJob(userId: string, jobRef: string | undefined): Promise<void> {
  if (!jobRef) return
  try {
    const { error } = await sbServiceRole().rpc('release_ai_job', {
      p_user_id: userId,
      p_job_ref: jobRef,
    })
    if (error) console.error('[ai-generate] release failed (job', jobRef, '):', error.message)
  } catch (re) {
    console.error('[ai-generate] release threw (job', jobRef, '):', re)
  }
}

// CHARGE a SUCCESSFUL generation (mig 114): price = real token cost × markup (the
// paid share), deducted from the micro-WON wallet. service_role; idempotent on
// job_ref; records the cost too (folds in the old finalize_ai_cost). PURELY
// post-hoc — it must NEVER mask the earned 200 or block it. Same await-and-inspect
// pattern (no `.catch` on the thenable). Returns the charge result (or null).
async function chargeGeneration(userId: string, jobRef: string | undefined, m: ResolvedModel, usage: TokenUsage | null): Promise<{ price_micro_won?: number; balance?: number; estimated?: boolean } | null> {
  if (!jobRef) return null
  // charge_ai_generation is idempotent (charged latch under FOR UPDATE) → safe to
  // retry. One inline retry shrinks the "charge lost after a delivered 200" window
  // (there is NO blind reconcile sweep — a lost charge is eaten as under-charge,
  // never wrong-charged). Best-effort throughout — must never mask the earned 200.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await sbServiceRole().rpc('charge_ai_generation', {
        p_user_id: userId,
        p_job_ref: jobRef,
        p_provider: m.provider,
        p_model: m.model,
        p_tokens_in: usage?.prompt_tokens ?? null,
        p_tokens_out: usage?.completion_tokens ?? null,
      })
      if (!error) return (data ?? null) as { price_micro_won?: number; balance?: number; estimated?: boolean } | null
      console.error('[ai-generate] charge failed (job', jobRef, 'attempt', attempt, '):', error.message)
    } catch (ce) {
      console.error('[ai-generate] charge threw (job', jobRef, 'attempt', attempt, '):', ce)
    }
  }
  return null
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

// Provider token usage (OpenAI-compatible `usage` object) — captured for the
// cost/margin layer (mig 112). null when a provider omits it.
interface TokenUsage { prompt_tokens: number; completion_tokens: number }
interface ProviderResult { content: string; usage: TokenUsage | null }
// Only sum when BOTH legs reported usage. If one leg omitted it, we billed both
// calls but can't know the missing leg's tokens → return null so the cost is
// recorded as `estimated` (honest unknown), never a confident undercount.
const sumUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null =>
  (a && b)
    ? { prompt_tokens: a.prompt_tokens + b.prompt_tokens, completion_tokens: a.completion_tokens + b.completion_tokens }
    : null

async function providerRequest(m: ResolvedModel, systemPrompt: string, userPrompt: string, imageUrl?: string): Promise<ProviderResult> {
  // Vision: the OpenAI-compatible shape carries the image in the user message
  // as a content array. Plain text uses a string.
  const userContent = imageUrl
    ? [{ type: 'text', text: userPrompt }, { type: 'image_url', image_url: { url: imageUrl } }]
    : userPrompt
  const body = {
    model: m.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
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
    // Capture token usage STRICTLY — only real, finite, non-negative numbers.
    // Reject null/''/strings (Number(null)===0 would forge a fake 0-cost row);
    // a missing/garbage usage → null → recorded as `estimated` downstream.
    const pin = data.usage?.prompt_tokens
    const pout = data.usage?.completion_tokens
    const usage: TokenUsage | null =
      (typeof pin === 'number' && Number.isFinite(pin) && pin >= 0 &&
       typeof pout === 'number' && Number.isFinite(pout) && pout >= 0)
        ? { prompt_tokens: pin, completion_tokens: pout }
        : null
    return { content: content as string, usage }
  }
  throw new Error('PROVIDER_ERROR')
}

// Returns parsed JSON + token usage; one stricter-prompt retry on unparseable
// output (mirrors callAI). On retry we paid for BOTH calls → SUM the usage.
async function generate(m: ResolvedModel, systemPrompt: string, userPrompt: string, imageUrl?: string): Promise<{ json: Record<string, unknown>; usage: TokenUsage | null }> {
  const a = await providerRequest(m, systemPrompt, userPrompt, imageUrl)
  try {
    return { json: JSON.parse(stripMarkdownFences(a.content)), usage: a.usage }
  } catch {
    const strict = systemPrompt +
      '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation, just pure JSON.'
    const b = await providerRequest(m, strict, userPrompt, imageUrl)
    return { json: JSON.parse(stripMarkdownFences(b.content)), usage: sumUsage(a.usage, b.usage) }
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

// Validate an uploaded image as a base64 data URL, size-capped (vision).
function asImage(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v)) return null
  if (v.length > MAX_IMAGE_BYTES) return null
  return v
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

    const body = await req.json().catch(() => null) as Record<string, any> | null
    if (!body) return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400, cors)

    const kind = body.kind
    if (kind !== 'template' && kind !== 'deck' && kind !== 'cards' && kind !== 'image') {
      return json({ error: 'Invalid kind', code: 'BAD_REQUEST' }, 400, cors)
    }
    const uiLang = typeof body.uiLang === 'string' ? body.uiLang : 'en'

    // Resolve provider+model by purpose (vision for image, text otherwise).
    const model = resolveModel(kind === 'image' ? 'vision' : 'text', ENV)
    if (!model) {
      console.error('[ai-generate] no provider configured (set AI_GENERATION_PROVIDER_KEY)')
      return json({ error: 'Server not configured', code: 'AI_NOT_CONFIGURED' }, 503, cors)
    }

    // Meter as the caller (auth.uid() resolves; a RAISE rolls back).
    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } },
    )

    // ── Image recognition (vision) — ALWAYS paid, separate metering ──
    if (kind === 'image') {
      const image = asImage(body.image)
      if (!image) return json({ error: 'Invalid image', code: 'BAD_REQUEST' }, 400, cors)
      const fields = asFields(body.fields)
      if (!fields) return json({ error: 'Invalid fields', code: 'BAD_REQUEST' }, 400, cors)
      const cardCount = Math.min(MAX_CARDS_PER_CALL, Math.max(1, Math.floor(Number(body.cardCount) || 10)))

      // Pre-gen GATE (reserve): rejects 402 if the wallet is empty (image is paid).
      const { data: imgRaw, error: imgErr } = await sbUser.rpc('reserve_ai_image')
      if (imgErr) {
        if (imgErr.code === 'P0002') return json({ error: 'Insufficient AI balance', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
        if (imgErr.code === '23514') return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
        console.error('[ai-generate] image reserve error:', imgErr.message)
        return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
      }
      const imgMeter = (imgRaw ?? {}) as { job_ref?: string }

      const { systemPrompt: iSys, userPrompt: iUser } = buildImageCardsPrompt(fields, cardCount, uiLang)
      try {
        const { json: content, usage } = await generate(model, iSys, iUser, image)
        // Post-gen CHARGE: deduct real token cost × markup from the wallet.
        const charge = await chargeGeneration(userId, imgMeter.job_ref, model, usage)  // best-effort, never masks the 200
        return json({ content, balance: charge?.balance ?? null }, 200, cors)
      } catch (e) {
        const msg = (e as Error).message
        console.error('[ai-generate] vision failure:', msg)
        await releaseJob(userId, imgMeter.job_ref)  // nothing charged pre-gen → net-zero
        const code = msg === 'PROVIDER_AUTH' ? 'AI_PROVIDER_AUTH' : 'AI_PROVIDER_ERROR'
        return json({ error: 'Generation failed', code }, 502, cors)
      }
    }

    // ── Text flow (template/deck/cards) ──
    const topic = asTopic(body.topic)
    if (!topic) return json({ error: 'Invalid topic', code: 'BAD_REQUEST' }, 400, cors)

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

    // Pre-gen GATE (reserve): compute free/paid split + reject 402 if the paid
    // portion has no wallet. NO money moved here (tokens unknown until post-gen).
    const { data: meterRaw, error: quotaErr } = await sbUser.rpc('reserve_ai_generation', {
      p_kind: kind,
      p_cards: pCards,
    })
    if (quotaErr) {
      // P0002 = paid cards requested but the wallet is empty → needs top-up.
      if (quotaErr.code === 'P0002') {
        return json({ error: 'Insufficient AI balance', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
      }
      // 23514 = daily request cap (abuse guard).
      if (quotaErr.code === '23514') {
        return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
      }
      console.error('[ai-generate] reserve error:', quotaErr.message)
      return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
    }
    // reserve returns the free/paid split + a job_ref (release on failure, charge on success).
    const meter = (meterRaw ?? {}) as {
      remaining_free?: number; free_now?: number; paid_now?: number; job_ref?: string
    }
    const remainingFree = typeof meter.remaining_free === 'number' ? meter.remaining_free : 0

    // Generate.
    let content: Record<string, unknown>
    let usage: TokenUsage | null
    try {
      const gen = await generate(model, systemPrompt, userPrompt)
      content = gen.json
      usage = gen.usage
    } catch (e) {
      const msg = (e as Error).message
      console.error('[ai-generate] provider failure:', msg)
      // Nothing was charged pre-gen (charge is post-gen) — just release the
      // reservation so the failed gen doesn't burn the daily free allowance.
      // Best-effort (don't mask the 502). Net-zero.
      await releaseJob(userId, meter.job_ref)
      const code = msg === 'PROVIDER_AUTH' ? 'AI_PROVIDER_AUTH' : 'AI_PROVIDER_ERROR'
      return json({ error: 'Generation failed', code }, 502, cors)
    }

    // Post-gen CHARGE: deduct real token cost × markup (paid share) from the wallet.
    await chargeGeneration(userId, meter.job_ref, model, usage)  // best-effort; never masks the 200
    return json({ content, remainingFree }, 200, cors)
  } catch (err) {
    console.error('[ai-generate] Error:', err)
    return json({ error: 'Generation failed', code: 'INTERNAL' }, 500, cors)
  }
})
