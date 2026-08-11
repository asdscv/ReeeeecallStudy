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
  buildImageDeckPrompt,
  type FieldHint,
  type GeneratedTemplateField,
} from '../_shared/ai-prompts.ts'
import { resolveModel, resolveModelChain, type ResolvedModel } from '../_shared/ai-providers.ts'
import { opsGate } from '../_shared/ops-gate.ts'
import { buildRemediationPrompt, compareGroundingError, parseRemediationRefs, validateRemediationResult } from '../_shared/ai-remediation.ts'
import { resolveCardAnswerFaces } from '../_shared/card-answer.ts'
import {
  quizPromptText, quizReferenceAnswer, quizContextFields,
} from '../_shared/quiz-answer-field.ts'
import {
  buildQuizCardSource,
  validateMultipleChoiceGeneration, validateShortAnswerGeneration, validateEssayGeneration,
  gradeGate, validateShortAnswerGrade, validateEssayGrade,
  DEFAULT_DIFFICULTY, isMcqDistractorFlaw,
  type QuizCardSource, type QuizItem, type EssayCriterion, type QuizDifficulty,
} from '../_shared/ai-quiz.ts'
import {
  QUIZ_TEMPERATURE,
  buildMcqGenerationPrompt, buildShortAnswerGenerationPrompt, buildEssayGenerationPrompt,
  buildShortAnswerGradePrompt, buildEssayGradePrompt, MAX_QUIZ_BATCH,
} from '../_shared/ai-quiz-prompts.ts'

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
// A per-MINUTE limit clears inside this; a per-DAY one never will, and waiting the full hint
// only burns the edge invocation before failing anyway.
const PROVIDER_MAX_BACKOFF_MS = 12000
const MAX_IMAGE_BYTES = 7_000_000          // ~5MB image as a base64 data URL (vision)
const MAX_IMAGES = 8                        // cap images per generation (context + payload)

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

// SETTLE a quiz job (mig 194). Deliberately NOT `chargeGeneration`: quiz is priced per
// unit from a list, not per card by markup, and `charge_ai_generation` refuses quiz jobs
// outright — if it did not, it would price them at zero AND stamp them charged, after
// which the hold could never be released.
//
// `delivered` is the count of items actually persisted, so an under-delivery is charged
// for what shipped and the rest of the hold is returned. Best-effort like the charge path
// above: it must never mask a delivered 200.
async function settleQuiz(
  userId: string, jobRef: string | undefined, delivered: number,
  m: ResolvedModel, usage: TokenUsage | null,
): Promise<{ price_micro?: number; balance?: number } | null> {
  if (!jobRef) return null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await sbServiceRole().rpc('settle_ai_quiz', {
        p_user_id: userId,
        p_job_ref: jobRef,
        p_delivered: delivered,
        p_provider: m.provider,
        p_model: m.model,
        p_tokens_in: usage?.prompt_tokens ?? null,
        p_tokens_out: usage?.completion_tokens ?? null,
      })
      if (!error) return (data ?? null) as { price_micro?: number; balance?: number } | null
      console.error('[ai-generate] quiz settle failed (job', jobRef, 'attempt', attempt, '):', error.message)
    } catch (se) {
      console.error('[ai-generate] quiz settle threw (job', jobRef, 'attempt', attempt, '):', se)
    }
  }
  return null
}

/**
 * A stable fingerprint of the card text a question was written from.
 *
 * This is what `content_version` on `learning_activities` was created for and never wired up:
 * it answers "has the source card changed since this question was written". Web Crypto, so no
 * dependency and no hand-rolled hash.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reserve errors are the same four everywhere; map them once. */
function quizReserveResponse(code: string | undefined, cors: Record<string, string>): Response | null {
  if (code === 'P0002') return json({ error: 'Insufficient AI balance', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
  if (code === 'P0008') return json({ error: 'Price changed since the quote', code: 'AI_PRICE_CHANGED' }, 409, cors)
  // P0009 is a SIZE error and 23514 is the daily cap. They are separate codes precisely so
  // this does not tell a learner who asked for too many questions that they are rate-limited.
  if (code === 'P0009') return json({ error: 'Request too large', code: 'AI_REQUEST_TOO_LARGE' }, 400, cors)
  if (code === 'P0010') return json({ error: 'Not enough quizzable cards', code: 'QUIZ_NOT_ENOUGH_CARDS' }, 422, cors)
  if (code === '23514') return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
  if (code === '42501') return json({ error: 'Not accessible', code: 'FORBIDDEN' }, 403, cors)
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

/**
 * How long the provider asked us to wait, in ms, or null if it did not say.
 *
 * Two sources, in order of trust: the `Retry-After` header (seconds, or an HTTP date), then
 * Gemini's own "Please retry in 24.546171743s" inside the error body. Reading the body is not
 * elegant, but the alternative is guessing — and guessing is what made every 429 fatal.
 */
function retryAfterMs(res: Response, body: string): number | null {
  const header = res.headers.get('retry-after')
  if (header) {
    const secs = Number(header)
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000)
    const at = Date.parse(header)
    if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  }
  const m = body.match(/retry in ([0-9.]+)s/i)
  if (m) {
    const secs = Number(m[1])
    // +1s: the provider's window is measured from ITS clock, and landing exactly on the
    // boundary is another 429 and another round trip.
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000) + 1000
  }
  return null
}

/**
 * The temperature every call used to share.
 *
 * Right for generation — variety IS the product when writing cards — and wrong for grading,
 * which `ai-quiz-prompts.ts` has said in a docblock since it exported `QUIZ_TEMPERATURE`
 * ({ generate: 0.7, grade: 0 }). Nothing ever imported that constant, so a learner who
 * resubmitted an identical short answer could get a different verdict and a different
 * `normalized_score` — which then feeds the planner, the insights and the weak-card list.
 */
const DEFAULT_TEMPERATURE = 0.8

async function providerRequest(m: ResolvedModel, systemPrompt: string, userPrompt: string, imageUrls?: string[], temperature = DEFAULT_TEMPERATURE): Promise<ProviderResult> {
  // Vision: the OpenAI-compatible shape carries the image(s) in the user message
  // as a content array — one text part plus one image_url part per image (the API
  // accepts multiple images in a single message). Plain text uses a string.
  const userContent = imageUrls && imageUrls.length
    ? [
        { type: 'text', text: userPrompt },
        ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : userPrompt
  const body = {
    model: m.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature,
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
    // A DAILY quota is not something a retry can outlast. Gemini names it in the violation
    // (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), and its own "retry in 58s" hint is
    // misleading there — waiting it out costs a minute of the caller's time and then fails.
    // Free tier on gemini-2.5-flash-lite is 20 requests A DAY, so this is a real state, not a
    // theoretical one, and the honest answer is to say so immediately.
    const dailyExhausted = res.status === 429
      && /PerDay|per day/i.test(await res.clone().text().catch(() => ''))
    if (dailyExhausted) {
      const body = await res.text().catch(() => '')
      console.error(`[ai-generate] provider daily quota exhausted: ${body.slice(0, 200)}`)
      throw new Error(`PROVIDER_LIMIT:${body.slice(0, 2000).replace(/\s+/g, ' ')}`)
    }
    if ((res.status === 429 || res.status >= 500) && attempt < PROVIDER_RETRY_DELAYS.length) {
      // Wait as long as the PROVIDER says to, not as long as we guessed.
      //
      // The free tier is 20 requests per minute and answers a 429 with "Please retry in
      // 24.5s" plus a Retry-After header. Our fixed 2s and 8s are both spent before that
      // window opens, so every retry is thrown at a closed door and the caller sees a hard
      // failure ~10s in — for a limit that would have cleared in 25.
      //
      // Capped at PROVIDER_MAX_BACKOFF_MS so a provider asking for minutes cannot hold an
      // edge invocation open past its own timeout.
      const hinted = retryAfterMs(res, await res.clone().text().catch(() => ''))
      await sleep(Math.min(hinted ?? PROVIDER_RETRY_DELAYS[attempt], PROVIDER_MAX_BACKOFF_MS))
      continue
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[ai-generate] provider ${res.status}: ${errBody.slice(0, 300)}`)
      // 429 after the retries are spent is a LIMIT, not a fault, and the two need different
      // words: "the service is busy, try again" sends someone back in a minute, while a
      // generic failure reads as "this feature is broken". The provider's own reason travels
      // with it so an operator can tell a per-minute rate limit from a daily quota without
      // reading edge logs — which the CLI cannot fetch.
      if (res.status === 429) {
        throw new Error(`PROVIDER_LIMIT:${errBody.slice(0, 2000).replace(/\s+/g, ' ')}`)
      }
      throw new Error(`PROVIDER_FAIL:${res.status} ${errBody.slice(0, 300).replace(/\s+/g, ' ')}`)
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
async function generateWith(m: ResolvedModel, systemPrompt: string, userPrompt: string, imageUrls?: string[], temperature = DEFAULT_TEMPERATURE): Promise<{ json: Record<string, unknown>; usage: TokenUsage | null }> {
  const a = await providerRequest(m, systemPrompt, userPrompt, imageUrls, temperature)
  try {
    return { json: JSON.parse(stripMarkdownFences(a.content)), usage: a.usage }
  } catch {
    const strict = systemPrompt +
      '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation, just pure JSON.'
    const b = await providerRequest(m, strict, userPrompt, imageUrls, temperature)
    return { json: JSON.parse(stripMarkdownFences(b.content)), usage: sumUsage(a.usage, b.usage) }
  }
}

/**
 * Generate, falling through to the next model when one is exhausted for the DAY.
 *
 * Free-tier quotas are per MODEL: `gemini-2.5-flash-lite` running out says nothing about
 * `gemini-2.0-flash`. Without this, one model's daily cap takes every AI feature down until
 * midnight — which is not a hypothetical, it is 20 requests a day on the current key.
 *
 * ONLY a daily quota falls through. A rate limit is already handled by the backoff inside
 * `providerRequest`, and a genuine fault would just fail again on another model while
 * spending its quota too.
 *
 * Returns the model that actually answered, because the cost ledger prices per model and
 * recording the one we asked for first would misattribute the spend.
 */
async function generate(
  chain: ResolvedModel[], systemPrompt: string, userPrompt: string, imageUrls?: string[],
  temperature = DEFAULT_TEMPERATURE,
): Promise<{ json: Record<string, unknown>; usage: TokenUsage | null; model: ResolvedModel }> {
  let lastError: unknown
  for (const [i, m] of chain.entries()) {
    try {
      const out = await generateWith(m, systemPrompt, userPrompt, imageUrls, temperature)
      if (i > 0) console.warn(`[ai-generate] fell back to ${m.model} after ${i} exhausted model(s)`)
      return { ...out, model: m }
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : ''
      if (!msg.startsWith('PROVIDER_LIMIT') || !/PerDay|per day/i.test(msg)) throw e
      // Exhausted for the day — try the next model in the chain.
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PROVIDER_ERROR')
}

// A generation result is USABLE only if it contains at least one non-empty list of items
// (cards / fields). Mirrors the client's extraction (it shows the first non-empty array in
// `content`), so "no items" = nothing the user can use. An empty-but-valid result (e.g.
// {"cards": []}) must NOT consume the free quota / wallet — the caller releases the job
// instead of charging. Prevents the "server succeeded + charged, but the user got nothing".
function resultHasItems(content: unknown): boolean {
  // An "item" counts only if it carries content — a non-null primitive, or an object with
  // at least one key. So a degenerate {cards:[{}]} (a structurally-present but empty card)
  // is treated as empty and NOT charged.
  const nonEmptyItem = (x: unknown): boolean =>
    x != null && (typeof x !== 'object' || Object.keys(x as object).length > 0)
  if (Array.isArray(content)) return content.some(nonEmptyItem)
  if (content && typeof content === 'object') {
    for (const v of Object.values(content as Record<string, unknown>)) {
      if (Array.isArray(v) && v.some(nonEmptyItem)) return true
    }
  }
  return false
}

// A 'deck' generation returns ARRAYLESS metadata ({name, description, color, icon}) — it is
// usable when it has a non-empty name (mirrors validateDeckResponse). All other kinds must
// carry a non-empty list of items (cards / template fields).
function resultIsUsable(kind: string, content: unknown): boolean {
  if (kind === 'deck') {
    const name = content && typeof content === 'object'
      ? (content as Record<string, unknown>).name : undefined
    return typeof name === 'string' && name.trim().length > 0
  }
  return resultHasItems(content)
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

// Validate an image payload that may be a single `image` string or an `images` array
// (multi-photo upload). Every item must pass asImage; the list is capped at MAX_IMAGES.
// Returns null when nothing valid is present or any item is invalid (fail-closed).
function asImages(images: unknown, image: unknown): string[] | null {
  const raw = Array.isArray(images) ? images : image != null ? [image] : []
  if (raw.length === 0 || raw.length > MAX_IMAGES) return null
  const out: string[] = []
  for (const it of raw) {
    const v = asImage(it)
    if (!v) return null
    out.push(v)
  }
  return out
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

    // Ops gate (mig 153): maintenance / AI kill switch / ban / burst rate limit.
    const gate = await opsGate(sbServiceRole(), {
      userId, requireAI: true, rateKey: `aigen:${userId}`, rateLimit: 20, rateWindowSec: 60,
    })
    if (gate) return json({ error: gate.message, code: gate.code }, gate.status, cors)

    const body = await req.json().catch(() => null) as Record<string, any> | null
    if (!body) return json({ error: 'Invalid body', code: 'BAD_REQUEST' }, 400, cors)

    const kind = body.kind
    if (kind !== 'template' && kind !== 'deck' && kind !== 'cards' && kind !== 'image' && kind !== 'image_deck' && kind !== 'remediation' && kind !== 'quiz_generate' && kind !== 'quiz_grade') {
      return json({ error: 'Invalid kind', code: 'BAD_REQUEST' }, 400, cors)
    }
    const uiLang = typeof body.uiLang === 'string' ? body.uiLang : 'en'

    // Resolve provider+model by purpose (vision for image kinds, text otherwise).
    const purpose = (kind === 'image' || kind === 'image_deck') ? 'vision' : 'text'
    // The chain, not a single model: one model's DAILY quota must not take the feature down.
    const chain = resolveModelChain(purpose, ENV)
    const model = chain[0] ?? resolveModel(purpose, ENV)
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

    // ── Structured learning remediation — always paid, user-specific preview ──
    if (kind === 'remediation') {
      const refs = parseRemediationRefs(body)
      if (!refs) return json({ error: 'Invalid remediation references', code: 'BAD_REQUEST' }, 400, cors)

      const { data: reserveRaw, error: reserveError } = await sbUser.rpc('reserve_ai_remediation', {
        p_action: refs.action,
        p_goal_id: refs.goalId,
        p_activity_id: refs.activityId,
        p_attempt_id: refs.attemptId,
        p_card_ids: refs.cardIds,
        p_concept_ids: refs.conceptIds,
      })
      if (reserveError) {
        if (reserveError.code === 'P0002') return json({ error: 'Insufficient AI balance', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
        if (reserveError.code === '23514') return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
        if (reserveError.code === '42501') return json({ error: 'Learning reference not accessible', code: 'FORBIDDEN' }, 403, cors)
        console.error('[ai-generate] remediation reserve error:', reserveError.message)
        return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
      }
      const meter = (reserveRaw ?? {}) as { job_ref?: string }
      const service = sbServiceRole()

      try {
        const [goalResult, activityResult, attemptResult, cardsResult, conceptsResult] = await Promise.all([
          refs.goalId ? service.from('learning_goals').select('id, domain_id, title, target, settings').eq('id', refs.goalId).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
          refs.activityId ? service.from('learning_activities').select('id, title, instructions, stimulus, expected_response, rubric, config, source_id, concept_id').eq('id', refs.activityId).maybeSingle() : Promise.resolve({ data: null, error: null }),
          refs.attemptId ? service.from('answer_attempts').select('id, card_id, activity_type, response_type, evaluator_type, response, normalized_score, evaluator_result, feedback, hints_used, duration_ms, created_at').eq('id', refs.attemptId).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
          refs.cardIds.length ? service.from('cards').select('id, template_id, field_values, tags').in('id', refs.cardIds) : Promise.resolve({ data: [], error: null }),
          refs.conceptIds.length ? service.from('learning_concepts').select('id, domain_id, title, description, source_id, metadata').in('id', refs.conceptIds) : Promise.resolve({ data: [], error: null }),
        ])
        const contextError = [goalResult, activityResult, attemptResult, cardsResult, conceptsResult].find((item) => item.error)?.error
        if (contextError) throw new Error(`CONTEXT_LOAD:${contextError.message}`)

        const concepts = (conceptsResult.data ?? []) as Array<Record<string, unknown>>
        const activity = activityResult.data as Record<string, unknown> | null
        const sourceIds = [...new Set([
          ...(typeof activity?.source_id === 'string' ? [activity.source_id] : []),
          ...concepts.flatMap((concept) => typeof concept.source_id === 'string' ? [concept.source_id] : []),
        ])]
        const sourceResult = sourceIds.length
          ? await service.from('content_sources').select('id, title, citation, metadata').in('id', sourceIds)
          : { data: [], error: null }
        if (sourceResult.error) throw new Error(`CONTEXT_LOAD:${sourceResult.error.message}`)
        const sources = (sourceResult.data ?? []) as Array<{ id: string; title: string; citation: string | null; metadata?: unknown }>
        // The failure PATTERN, not just this one failure. Scores and timestamps only, capped at
        // 5, one indexed user-scoped query — so a learner with thousands of attempts cannot
        // widen the prompt, and nothing the learner wrote leaves the request it belongs to.
        // Only fetched when the request is attempt-grounded AND names a card: without a card
        // there is no "same item" to build a history for.
        // Keyed on the card the ATTEMPT is on — not the card the request happens to name. Those
        // can differ (mig 178 rejects that pair, but only later, at the write), and a history
        // built from the wrong card would hand the model a "failure pattern" for another item.
        // An attempt against an activity rather than a card has no same-card history at all.
        const attemptCardId = (attemptResult.data as { card_id?: string | null } | null)?.card_id ?? null
        const historyCardId = refs.attemptId ? attemptCardId : null
        let attemptHistory: Array<{ normalized_score: number | null; created_at: string }> = []
        if (historyCardId) {
          const historyResult = await service
            .from('answer_attempts')
            .select('normalized_score, created_at')
            .eq('user_id', userId)
            .eq('card_id', historyCardId)
            .order('created_at', { ascending: false })
            .limit(5)
          // A missing history must not fail a paid request the learner already reserved credits
          // for: it is context, not a precondition. Log and continue with an empty list.
          if (historyResult.error) console.error('[ai-generate] attempt history read failed:', historyResult.error.message)
          else attemptHistory = (historyResult.data ?? []) as Array<{ normalized_score: number | null; created_at: string }>
        }
        // `buildRemediationPrompt` serializes this whole object and TRUNCATES at 64KB, so key
        // order decides what survives. attemptHistory sits next to the attempt it belongs to
        // rather than last: `sources` carries arbitrary metadata and can be large, and the
        // evidence a grounded request was paid for must not be the first thing cut.
        // The expected answer for `compare`, resolved SERVER-side from the template the card
        // declares. Service-role reads it, so a subscriber whose RLS hides a non-default
        // template still gets a grounded comparison — and the client never gets to say what the
        // right answer is. `resolveCardAnswerFaces` returns null rather than guessing a field.
        let expectedAnswer: { keys: string[]; text: string } | null = null
        if (refs.action === 'compare' && attemptCardId) {
          const answerCard = (cardsResult.data ?? []).find((row) => (row as { id: string }).id === attemptCardId) as
            { id: string; template_id: string | null; field_values: Record<string, string> } | undefined
          if (answerCard?.template_id) {
            const templateResult = await service
              .from('card_templates')
              .select('id, fields, front_layout, back_layout')
              .eq('id', answerCard.template_id)
              .maybeSingle()
            if (templateResult.error) console.error('[ai-generate] template read failed:', templateResult.error.message)
            const faces = resolveCardAnswerFaces(templateResult.data as never, answerCard as never)
            if (faces) {
              const text = faces.referenceKeys.map((key) => answerCard.field_values[key].trim()).join(' / ')
              if (text !== '') expectedAnswer = { keys: [...faces.referenceKeys], text }
            }
          }
        }

        // Refuse BEFORE the model call, and inside the try so `releaseJob` reverses the
        // reservation. Charging for `compare` and returning a generic explanation is the exact
        // dishonesty this action was held back to avoid, so it is never a silent degrade.
        if (refs.action === 'compare') {
          const ungrounded = compareGroundingError(attemptResult.data, expectedAnswer)
          if (ungrounded) throw new Error(`COMPARE_UNGROUNDED:${ungrounded}`)
        }

        // `buildRemediationPrompt` serializes this whole object and TRUNCATES at 64KB, so key
        // order decides what survives. The comparison's two sides sit next to the attempt, ahead
        // of `sources`, which carries arbitrary metadata and can be large.
        const context = {
          goal: goalResult.data,
          activity: activityResult.data,
          attempt: attemptResult.data,
          attemptHistory,
          expectedAnswer,
          cards: cardsResult.data ?? [],
          concepts,
          sources,
        }
        const prompt = buildRemediationPrompt(refs, context)
        if (prompt.requireGrounding && sources.length === 0) throw new Error('GROUNDING_SOURCE_REQUIRED')

        const generated = await generate(chain, prompt.systemPrompt, prompt.userPrompt)
        const validated = validateRemediationResult(generated.json, refs, sources.map((source) => source.id), prompt.requireGrounding)
        if (!validated.valid) throw new Error(`INVALID_REMEDIATION:${validated.reason}`)

        const { data: enrichmentId, error: persistenceError } = await service.rpc('persist_ai_remediation', {
          p_user_id: userId,
          p_action: refs.action,
          p_content: validated.content,
          p_source_refs: validated.sourceIds,
          p_goal_id: refs.goalId,
          p_concept_id: refs.conceptIds[0] ?? null,
          p_card_id: refs.cardIds[0] ?? null,
          p_activity_id: refs.activityId,
          p_request_fingerprint: JSON.stringify(refs).slice(0, 128),
          p_model_version: model.model,
          p_provider: model.provider,
          p_prompt_version: 'remediation-v3',
          // Provenance (mig 178). `request_fingerprint` is a 128-char truncation and cannot be
          // relied on to say which failure this answer was about.
          p_attempt_id: refs.attemptId,
        })
        if (persistenceError || typeof enrichmentId !== 'string') throw new Error(`PERSISTENCE:${persistenceError?.message ?? 'missing id'}`)

        const charge = await chargeGeneration(userId, meter.job_ref, generated.model, generated.usage)
        return json({ content: validated.content, enrichmentId, balance: charge?.balance ?? null }, 200, cors)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN'
        console.error('[ai-generate] remediation failure:', message)
        await releaseJob(userId, meter.job_ref)
        // An ungrounded compare is the CALLER's situation, not a provider fault: 400, and with
        // its own code per reason. "Write your answer first" and "this card never marked which
        // field is the answer" need different words — one the learner can act on, one they
        // cannot — and collapsing them into a generic failure is how a support ticket is born.
        const ungroundedCompare = message.startsWith('COMPARE_UNGROUNDED:')
        const status = message.startsWith('CONTEXT_LOAD') || message === 'GROUNDING_SOURCE_REQUIRED'
          || ungroundedCompare ? 400 : 502
        const code = message === 'GROUNDING_SOURCE_REQUIRED' ? 'AI_GROUNDING_REQUIRED'
          : message === 'COMPARE_UNGROUNDED:NO_LEARNER_ANSWER' ? 'AI_COMPARE_NO_ANSWER'
          : message === 'COMPARE_UNGROUNDED:NO_REFERENCE_ANSWER' ? 'AI_COMPARE_NO_REFERENCE'
          : message.startsWith('PERSISTENCE:') ? 'AI_PERSISTENCE_ERROR'
          : message.startsWith('INVALID_REMEDIATION:') ? 'AI_INVALID_RESULT'
          : 'AI_PROVIDER_ERROR'
        return json({ error: 'Remediation failed', code }, status, cors)
      }
    }

    // ── Quiz generation — the set is the paid asset; retaking it is free ──
    //
    // The model NEVER writes the correct answer. For multiple choice it returns distractors
    // and this function inserts the card's own primary field at a position derived from the
    // item id, so a wrong answer cannot be smuggled into the correct slot and position bias
    // is unreachable rather than merely mitigated.
    if (kind === 'quiz_generate') {
      const setId = typeof body.setId === 'string' ? body.setId : null
      const clientRef = typeof body.clientRef === 'string' ? body.clientRef : null
      const maxPrice = typeof body.maxPriceMicro === 'number' ? body.maxPriceMicro : null
      const qType = body.questionType
      if (!setId || !clientRef || maxPrice === null
          || (qType !== 'mcq' && qType !== 'short' && qType !== 'essay')) {
        return json({ error: 'Invalid quiz generation request', code: 'BAD_REQUEST' }, 400, cors)
      }

      const service = sbServiceRole()
      // The set already exists — `create_quiz_set` made it and chose the cards, using the
      // same eligibility rule that counted them for the quote. Re-selecting here would be a
      // fourth copy of that rule and could disagree with the number the learner approved.
      const setResult = await service.from('quiz_sets')
        .select('id, owner_user_id, deck_id, question_type, scope_kind, scope_tags, scope_card_ids, requested_count, content_locale, difficulty')
        .eq('id', setId).eq('owner_user_id', userId).maybeSingle()
      if (setResult.error || !setResult.data) {
        return json({ error: 'Quiz set not accessible', code: 'FORBIDDEN' }, 403, cors)
      }
      const quizSet = setResult.data as {
        deck_id: string; question_type: string; scope_kind: string
        scope_tags: string[]; scope_card_ids: string[]; requested_count: number
        content_locale: string; difficulty: number
      }
      if (quizSet.question_type !== qType) {
        return json({ error: 'Question type does not match the set', code: 'BAD_REQUEST' }, 400, cors)
      }

      // The FAR slots are filled from the learner's own deck; `create_quiz_set` supplies the
      // pool from the same eligibility resolver everything else uses.
      const fillers = Array.isArray(body.fillers)
        ? body.fillers.filter((v: unknown): v is string => typeof v === 'string')
        : []
      const cardIds = Array.isArray(body.cardIds)
        ? body.cardIds.filter((v: unknown): v is string => typeof v === 'string')
        : []
      const batchCap = MAX_QUIZ_BATCH[
        qType === 'mcq' ? 'multiple_choice' : qType === 'short' ? 'short_answer' : 'essay'
      ]
      if (cardIds.length === 0 || cardIds.length > batchCap) {
        return json({ error: 'Request too large', code: 'AI_REQUEST_TOO_LARGE' }, 400, cors)
      }

      const action = qType === 'mcq' ? 'generate_mcq' : qType === 'short' ? 'generate_short' : 'generate_essay'
      const { data: reserveRaw, error: reserveError } = await sbUser.rpc('reserve_ai_quiz', {
        p_action: action,
        p_count: cardIds.length,
        p_client_ref: clientRef,
        p_max_price_micro: maxPrice,
        p_deck_id: quizSet.deck_id,
        p_card_ids: cardIds,
        p_set_id: setId,
      })
      if (reserveError) {
        const mapped = quizReserveResponse(reserveError.code, cors)
        if (mapped) return mapped
        console.error('[ai-generate] quiz reserve error:', reserveError.message)
        return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
      }
      const meter = (reserveRaw ?? {}) as { job_ref?: string; replayed?: boolean }

      try {
        const cardsResult = await service.from('cards')
          .select('id, template_id, field_values')
          .in('id', cardIds).eq('deck_id', quizSet.deck_id)
        if (cardsResult.error) throw new Error(`CONTEXT_LOAD:${cardsResult.error.message}`)
        const cards = (cardsResult.data ?? []) as Array<{ id: string; template_id: string; field_values: Record<string, string> }>

        const templateIds = [...new Set(cards.map((c) => c.template_id))]
        const templatesResult = await service.from('card_templates')
          .select('id, fields, front_layout, back_layout').in('id', templateIds)
        if (templatesResult.error) throw new Error(`CONTEXT_LOAD:${templatesResult.error.message}`)
        const templateById = new Map(
          (templatesResult.data ?? []).map((t: Record<string, unknown>) => [t.id as string, t]),
        )

        // Resolve every card to its ONE graded field. A card that cannot be resolved is
        // excluded, never included with a positional guess — for the official word templates
        // that guess is inverted and would build the whole quiz around the wrong half.
        const sources: QuizCardSource[] = []
        const fingerprints = new Map<string, string>()
        for (const card of cards) {
          // deno-lint-ignore no-explicit-any
          const template = templateById.get(card.template_id) as any
          const prompt = quizPromptText(template, card)
          const answer = quizReferenceAnswer(template, card)
          if (!prompt || !answer) continue
          // The template's own field names travel with the values. Without them a
          // `field_probe` question reads "what is the context0 of lend?" — the model can only
          // ask about a field it can name.
          const source = buildQuizCardSource(
            card.id, prompt, answer, quizContextFields(template, card), fillers)
          if (!source) continue
          sources.push(source)
          // Answers the question `content_version` was created for and never wired up:
          // has the source card changed since this question was written?
          fingerprints.set(card.id, await sha256Hex(`${prompt} ${answer}`))
        }
        if (sources.length === 0) throw new Error('QUIZ_NO_ELIGIBLE_CARDS')

        // Resolved from the band the SET recorded, never from the request body: the learner
        // picked it at creation time, and a later call must not be able to quietly change it.
        // Every type, not just multiple choice. Difficulty used to mean "how many wrong
        // options are near-misses", which short answer and essay do not have — so the two
        // types we actually charge for had no difficulty at all.
        let difficulty: QuizDifficulty = DEFAULT_DIFFICULTY
        {
          const bandResult = await service.from('quiz_difficulty_levels')
            .select('level, near_required, near_max, option_count, allowed_flaws, guidance')
            .eq('level', quizSet.difficulty).maybeSingle()
          const band = bandResult.data as {
            level: number; near_required: number; near_max: number
            option_count: number; allowed_flaws: string[]
            guidance: Record<string, string> | null
          } | null
          if (band) {
            difficulty = {
              level: band.level,
              nearRequired: band.near_required,
              nearMax: band.near_max ?? band.near_required,
              optionCount: band.option_count,
              // Filtered against the contract rather than trusted: a name the validator does
              // not know would restrict the band to nothing and drop every item, which reads
              // as a model failure instead of a typo in a config row.
              allowedFlaws: (band.allowed_flaws ?? []).filter(isMcqDistractorFlaw),
              // The band's instruction for THIS type. `create_quiz_set` already refused a
              // type the band has no guidance for, so a missing one here is a config change
              // mid-flight rather than a state a learner can reach.
              guidance: band.guidance?.[qType],
            }
          }
        }

        // `content_locale` is the UI language at creation time. It settles ONE thing: which
        // side of a cross-lingual card the question addresses the learner in.
        const uiLocale = quizSet.content_locale
        const prompt = qType === 'mcq' ? buildMcqGenerationPrompt(sources, difficulty, uiLocale)
          : qType === 'short' ? buildShortAnswerGenerationPrompt(sources, difficulty, uiLocale)
          : buildEssayGenerationPrompt(sources, difficulty, uiLocale)
        const generated = await generate(chain, prompt.systemPrompt, prompt.userPrompt)

        const makeItemId = (cardId: string, index: number) => `${setId}:${cardId}:${index}`
        const outcome = qType === 'mcq'
          ? validateMultipleChoiceGeneration(generated.json, sources, makeItemId, difficulty)
          : qType === 'short'
            ? validateShortAnswerGeneration(generated.json, sources, makeItemId)
            : validateEssayGeneration(generated.json, sources, makeItemId)

        // The drop reasons ARE the prompt's report card; they are the only signal that would
        // ever tell us a prompt change made distractors worse.
        if (outcome.dropped.length > 0) {
          console.warn('[ai-generate] quiz drops:', JSON.stringify(outcome.dropped))
        }
        // Advisory, never fatal. A band whose instruction has stopped working shows up here
        // instead of only to someone reading the questions.
        const offBand = outcome.items.filter((i) => 'offBand' in i && i.offBand).length
        if (offBand > 0) {
          console.warn(`[ai-generate] band ${difficulty.level}: ${offBand}/${outcome.items.length} items outside the advisory near range`)
        }
        // Fewer than half the requested items is not a quiz worth charging for.
        if (!outcome.servable) {
          // One drop reason dominating the batch is not a generation failure, it is a MISMATCH
          // between the deck and the question type, and the learner can act on it. An essay
          // rubric grounds its criteria in terms quoted from the card; a two-word vocabulary
          // card has nothing to quote, so every item comes back `ungrounded_mention`. Telling
          // that learner "the AI produced nothing usable" sends them to retry forever.
          const reasons = outcome.dropped.map((d) => d.reason)
          const ungrounded = reasons.filter((r) => r === 'ungrounded_mention').length
          if (reasons.length > 0 && ungrounded * 2 >= reasons.length) {
            throw new Error(`QUIZ_CARDS_TOO_SHORT:${JSON.stringify(outcome.dropped)}`)
          }
          // The reasons travel with the error. They are enum members plus card ids the caller
          // already owns — no card content — and without them an empty result is unfalsifiable:
          // "the model wrote nothing usable" and "our validator is too strict" look identical.
          throw new Error(`QUIZ_UNSERVABLE:${JSON.stringify(outcome.dropped)}`)
        }

        const questions = outcome.items.map((item: QuizItem) => {
          const base = {
            card_id: item.cardId,
            stem: item.question,
            source_fingerprint: fingerprints.get(item.cardId) ?? 'unknown',
            reference_context: sources.find((s) => s.cardId === item.cardId)?.extraFields
              .map((f) => `${f.label}: ${f.value}`).join(' / ') || null,
          }
          if (item.type === 'multiple_choice') {
            return {
              ...base,
              options: item.options,
              correct_index: item.correctIndex,
              reference_answer: item.options[item.correctIndex],
              meta: { flaws: item.flaws },
            }
          }
          if (item.type === 'short_answer') {
            return { ...base, reference_answer: item.expected, meta: { angle: item.angle, crossLingual: item.crossLingual } }
          }
          return {
            ...base,
            reference_answer: item.reference,
            rubric: item.criteria,
            meta: { lengthBand: item.lengthBand },
          }
        })

        const { error: persistError } = await service.rpc('persist_quiz_questions', {
          p_set_id: setId,
          p_questions: questions,
        })
        if (persistError) throw new Error(`PERSISTENCE:${persistError.message}`)

        // Charged for what shipped, not for what was asked for.
        const settled = await settleQuiz(userId, meter.job_ref, questions.length, generated.model, generated.usage)
        return json({
          setId, generated: questions.length, requested: cardIds.length,
          dropped: outcome.dropped.length, balance: settled?.balance ?? null,
        }, 200, cors)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN'
        console.error('[ai-generate] quiz generation failure:', message)
        await releaseJob(userId, meter.job_ref)
        const code = message === 'QUIZ_NO_ELIGIBLE_CARDS' ? 'QUIZ_NOT_ENOUGH_CARDS'
          : message.startsWith('QUIZ_CARDS_TOO_SHORT') ? 'QUIZ_CARDS_TOO_SHORT'
          : message.startsWith('QUIZ_UNSERVABLE') ? 'AI_EMPTY_RESULT'
          : message.startsWith('PROVIDER_LIMIT')
            ? (/PerDay|per day/i.test(message) ? 'AI_PROVIDER_DAILY_LIMIT' : 'AI_PROVIDER_BUSY')
          : message.startsWith('PROVIDER_FAIL') ? 'AI_PROVIDER_ERROR'
          : message.startsWith('CONTEXT_LOAD') ? 'AI_CONTEXT_ERROR'
          : message.startsWith('PERSISTENCE:') ? 'AI_PERSISTENCE_ERROR'
          : 'AI_PROVIDER_ERROR'
        const status = code === 'QUIZ_NOT_ENOUGH_CARDS' || code === 'QUIZ_CARDS_TOO_SHORT'
          || code === 'AI_EMPTY_RESULT' ? 422
          : code === 'AI_CONTEXT_ERROR' ? 400
          : code === 'AI_PROVIDER_BUSY' || code === 'AI_PROVIDER_DAILY_LIMIT' ? 429 : 502
        const marker = ['QUIZ_UNSERVABLE:', 'QUIZ_CARDS_TOO_SHORT:'].find((m) => message.startsWith(m))
        const dropped = marker ? JSON.parse(message.slice(marker.length)) : undefined
        // Operator-facing, and safe: it is the provider's own words about OUR key, with no
        // learner content in it. Without it, diagnosing a limit means reading edge logs the
        // CLI cannot fetch.
        const providerReason = message.startsWith('PROVIDER_LIMIT:')
          ? message.slice('PROVIDER_LIMIT:'.length)
          : message.startsWith('PROVIDER_FAIL:') ? message.slice('PROVIDER_FAIL:'.length)
          : undefined
        return json({ error: 'Quiz generation failed', code, dropped, providerReason }, status, cors)
      }
    }

    // ── Quiz grading — the repeating meter ──
    //
    // Charged per submitted answer, because unlike generation this cannot be cached: the
    // learner writes something different every time. Multiple choice never reaches here —
    // `submit_quiz_answer` grades it by index comparison in SQL, for free, and `grade_mcq`
    // has no row in `ai_quiz_price_units` so it cannot even be reserved.
    if (kind === 'quiz_grade') {
      const itemId = typeof body.runItemId === 'string' ? body.runItemId : null
      const clientRef = typeof body.clientRef === 'string' ? body.clientRef : null
      const maxPrice = typeof body.maxPriceMicro === 'number' ? body.maxPriceMicro : null
      const learner = typeof body.answer === 'string' ? body.answer : ''
      if (!itemId || !clientRef || maxPrice === null) {
        return json({ error: 'Invalid quiz grading request', code: 'BAD_REQUEST' }, 400, cors)
      }

      const service = sbServiceRole()
      const itemResult = await service.from('quiz_run_items')
        .select('id, question_id, run_id, status, quiz_runs!inner(user_id)')
        .eq('id', itemId).maybeSingle()
      if (itemResult.error || !itemResult.data
          || (itemResult.data as { quiz_runs?: { user_id?: string } }).quiz_runs?.user_id !== userId) {
        return json({ error: 'Quiz item not accessible', code: 'FORBIDDEN' }, 403, cors)
      }
      const questionId = (itemResult.data as { question_id: string | null }).question_id
      if (!questionId) return json({ error: 'This question no longer exists', code: 'QUIZ_ITEM_GONE' }, 410, cors)

      const qResult = await service.from('quiz_questions')
        .select('id, question_type, stem, reference_answer, reference_context, rubric, meta')
        .eq('id', questionId).maybeSingle()
      if (qResult.error || !qResult.data) {
        return json({ error: 'This question no longer exists', code: 'QUIZ_ITEM_GONE' }, 410, cors)
      }
      const question = qResult.data as {
        question_type: string; stem: string; reference_answer: string
        reference_context: string | null; rubric: EssayCriterion[] | null
        meta: { crossLingual?: boolean } | null
      }
      if (question.question_type === 'mcq') {
        return json({ error: 'Multiple choice is graded without AI', code: 'BAD_REQUEST' }, 400, cors)
      }
      const quizType = question.question_type === 'essay' ? 'essay' : 'short_answer'

      // BEFORE the reservation. An empty submission does not need a model to be graded 0
      // and must not cost one; an over-length submission is refused rather than truncated,
      // because grading the first 2000 characters of a 4000-character essay grades an essay
      // the learner did not write — and charges them for it.
      const gate = gradeGate(quizType, learner)
      if (!gate.ok) {
        return json({ error: 'Answer cannot be graded', code: 'QUIZ_UNGRADEABLE', reason: gate.refusal }, 400, cors)
      }

      const action = quizType === 'essay' ? 'grade_essay' : 'grade_short'
      const { data: reserveRaw, error: reserveError } = await sbUser.rpc('reserve_ai_quiz', {
        p_action: action,
        p_count: 1,
        p_client_ref: clientRef,
        p_max_price_micro: maxPrice,
        p_run_item_id: itemId,
      })
      if (reserveError) {
        const mapped = quizReserveResponse(reserveError.code, cors)
        if (mapped) return mapped
        console.error('[ai-generate] quiz grade reserve error:', reserveError.message)
        return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
      }
      const meter = (reserveRaw ?? {}) as { job_ref?: string }

      try {
        const gradeInput = {
          question: question.stem,
          reference: question.reference_answer,
          learner: learner.trim(),
          crossLingual: question.meta?.crossLingual === true,
        }
        const criteria = question.rubric ?? []
        if (quizType === 'essay' && criteria.length === 0) throw new Error('QUIZ_NO_RUBRIC')

        const prompt = quizType === 'essay'
          ? buildEssayGradePrompt(gradeInput, criteria)
          : buildShortAnswerGradePrompt(gradeInput)
        // Grading is the one call where variety is a defect: the same answer submitted twice
        // must get the same mark, because `normalized_score` is written to the attempt and
        // then read by the planner, the insights and the weak-card list. `QUIZ_TEMPERATURE`
        // has said so since it was written and had no importer until now.
        const generated = await generate(
          chain, prompt.systemPrompt, prompt.userPrompt, undefined, QUIZ_TEMPERATURE.grade)

        const verdict = quizType === 'essay'
          ? validateEssayGrade(generated.json, criteria, gradeInput)
          : validateShortAnswerGrade(generated.json, gradeInput)

        // A refusal is not a zero. Releasing means the learner is charged nothing and no
        // score is written — scoring them 0 because our grader returned nonsense would put
        // our failure on their record.
        if (!verdict.graded) {
          await releaseJob(userId, meter.job_ref)
          return json({ error: 'Grading failed', code: 'QUIZ_GRADE_REFUSED', reason: verdict.refusal }, 422, cors)
        }

        const grade = verdict.grade as { score: number }
        const { error: applyError } = await service.rpc('apply_quiz_grade', {
          p_run_item_id: itemId,
          p_score: grade.score,
          p_evaluator_result: grade,
          // Everything the screen renders: a label from a closed set, and spans into text
          // the learner already has. Not one character of model-written prose.
          p_feedback: grade,
          p_evaluator_version: `${model.provider}:${model.model}`,
        })
        if (applyError) throw new Error(`PERSISTENCE:${applyError.message}`)

        const settled = await settleQuiz(userId, meter.job_ref, 1, generated.model, generated.usage)
        return json({ itemId, grade, balance: settled?.balance ?? null }, 200, cors)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN'
        console.error('[ai-generate] quiz grading failure:', message)
        await releaseJob(userId, meter.job_ref)
        const code = message === 'QUIZ_NO_RUBRIC' ? 'QUIZ_ITEM_GONE'
          : message.startsWith('PERSISTENCE:') ? 'AI_PERSISTENCE_ERROR'
          : 'AI_PROVIDER_ERROR'
        return json({ error: 'Quiz grading failed', code }, code === 'QUIZ_ITEM_GONE' ? 410 : 502, cors)
      }
    }

    // ── Image recognition (vision) — ALWAYS paid, separate metering ──
    if (kind === 'image') {
      const images = asImages(body.images, body.image)
      if (!images) return json({ error: 'Invalid image', code: 'BAD_REQUEST' }, 400, cors)
      const fields = asFields(body.fields)
      if (!fields) return json({ error: 'Invalid fields', code: 'BAD_REQUEST' }, 400, cors)
      // Image mode: the MODEL decides how many cards to make from what's actually in
      // the image (one per item), capped at MAX_CARDS_PER_CALL — the user does NOT set
      // a count. So we pass the cap as the max, not a target.
      const cardCount = MAX_CARDS_PER_CALL

      // Owned-card limit (mig 116): fail fast only if the account is fully at the cap
      // (the real count is model-decided; the save path enforces the exact limit).
      const { error: imgCardLimitErr } = await sbUser.rpc('check_card_limit_self', { p_adding: 1 })
      if (imgCardLimitErr) {
        if (imgCardLimitErr.code === 'PT402' || (imgCardLimitErr as { hint?: string }).hint === 'CARD_LIMIT_REACHED') {
          return json({ error: 'Card limit reached', code: 'CARD_LIMIT_REACHED' }, 402, cors)
        }
        console.error('[ai-generate] image card-limit check error:', imgCardLimitErr.message)
        return json({ error: 'Card limit check failed', code: 'CARD_LIMIT_ERROR' }, 500, cors)
      }

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
        const { json: content, usage, model: usedModel } = await generate(chain, iSys, iUser, images)
        if (!resultHasItems(content)) {   // empty vision result → refund, don't charge
          console.error('[ai-generate] image empty result — releasing job', imgMeter.job_ref)
          await releaseJob(userId, imgMeter.job_ref)
          return json({ error: 'No cards recognized in the image', code: 'AI_EMPTY_RESULT' }, 502, cors)
        }
        // Post-gen CHARGE: deduct real token cost × markup from the wallet.
        const charge = await chargeGeneration(userId, imgMeter.job_ref, usedModel, usage)  // best-effort, never masks the 200
        return json({ content, balance: charge?.balance ?? null }, 200, cors)
      } catch (e) {
        const msg = (e as Error).message
        console.error('[ai-generate] vision failure:', msg)
        await releaseJob(userId, imgMeter.job_ref)  // nothing charged pre-gen → net-zero
        const code = msg === 'PROVIDER_AUTH' ? 'AI_PROVIDER_AUTH' : 'AI_PROVIDER_ERROR'
        return json({ error: 'Generation failed', code }, 502, cors)
      }
    }

    // ── Image recognition → a COMPLETE new deck (metadata + template + cards) ──
    // ALWAYS paid (same metering as image cards). One vision call returns the whole
    // deck; the client reviews + saves it (createDeck + template + cards).
    if (kind === 'image_deck') {
      const images = asImages(body.images, body.image)
      if (!images) return json({ error: 'Invalid image', code: 'BAD_REQUEST' }, 400, cors)

      // Owned-card limit (mig 116): fail fast if the account is already at the cap
      // (there's no room for even one generated card).
      const { error: idCardLimitErr } = await sbUser.rpc('check_card_limit_self', { p_adding: 1 })
      if (idCardLimitErr) {
        if (idCardLimitErr.code === 'PT402' || (idCardLimitErr as { hint?: string }).hint === 'CARD_LIMIT_REACHED') {
          return json({ error: 'Card limit reached', code: 'CARD_LIMIT_REACHED' }, 402, cors)
        }
        console.error('[ai-generate] image_deck card-limit check error:', idCardLimitErr.message)
        return json({ error: 'Card limit check failed', code: 'CARD_LIMIT_ERROR' }, 500, cors)
      }

      // Pre-gen GATE (reserve): rejects 402 if the wallet is empty (image is paid).
      const { data: idRaw, error: idErr } = await sbUser.rpc('reserve_ai_image')
      if (idErr) {
        if (idErr.code === 'P0002') return json({ error: 'Insufficient AI balance', code: 'AI_INSUFFICIENT_CREDITS' }, 402, cors)
        if (idErr.code === '23514') return json({ error: 'Too many requests today', code: 'AI_RATE_CAP' }, 429, cors)
        console.error('[ai-generate] image_deck reserve error:', idErr.message)
        return json({ error: 'Metering error', code: 'AI_METER_ERROR' }, 500, cors)
      }
      const idMeter = (idRaw ?? {}) as { job_ref?: string }

      const { systemPrompt: dSys, userPrompt: dUser } = buildImageDeckPrompt(uiLang)
      try {
        const { json: content, usage, model: usedModel } = await generate(chain, dSys, dUser, images)
        if (!resultHasItems(content)) {   // empty deck result → refund, don't charge
          console.error('[ai-generate] image_deck empty result — releasing job', idMeter.job_ref)
          await releaseJob(userId, idMeter.job_ref)
          return json({ error: 'No deck could be built from the image', code: 'AI_EMPTY_RESULT' }, 502, cors)
        }
        const charge = await chargeGeneration(userId, idMeter.job_ref, usedModel, usage)
        return json({ content, balance: charge?.balance ?? null }, 200, cors)
      } catch (e) {
        const msg = (e as Error).message
        console.error('[ai-generate] image_deck vision failure:', msg)
        await releaseJob(userId, idMeter.job_ref)
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

    // Owned-card limit (mig 116): block BEFORE spending AI credits/free quota if
    // saving these cards would exceed the account's card cap.
    const { error: cardLimitErr } = await sbUser.rpc('check_card_limit_self', { p_adding: pCards })
    if (cardLimitErr) {
      if (cardLimitErr.code === 'PT402' || (cardLimitErr as { hint?: string }).hint === 'CARD_LIMIT_REACHED') {
        return json({ error: 'Card limit reached', code: 'CARD_LIMIT_REACHED' }, 402, cors)
      }
      console.error('[ai-generate] card-limit check error:', cardLimitErr.message)
      return json({ error: 'Card limit check failed', code: 'CARD_LIMIT_ERROR' }, 500, cors)
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
  // The model that ANSWERED — a daily-quota fallback is a different model at a different
  // rate, and charging the one we asked for first would misattribute the spend.
  let usedModel: ResolvedModel = model
    try {
      const gen = await generate(chain, systemPrompt, userPrompt)
      content = gen.json
      usage = gen.usage
      usedModel = gen.model
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

    // EMPTY-RESULT GUARD: a valid-but-empty result (no cards/items) must NOT consume the
    // free quota or wallet. Release the reservation and error instead of charging, so a
    // "server succeeded but produced nothing" never burns the user's daily free allowance.
    // KIND-AWARE: a 'deck' result is arrayless metadata (usable iff it has a name); template
    // (fields[]) and cards (cards[]) must carry items. Only refund a TRULY empty result.
    if (!resultIsUsable(kind, content)) {
      console.error('[ai-generate] empty/unusable', kind, 'result — releasing job', meter.job_ref)
      await releaseJob(userId, meter.job_ref)
      return json({ error: 'Generation returned no usable content', code: 'AI_EMPTY_RESULT' }, 502, cors)
    }

    // Post-gen CHARGE: deduct real token cost × markup (paid share) from the wallet.
    await chargeGeneration(userId, meter.job_ref, usedModel, usage)  // best-effort; never masks the 200
    return json({ content, remainingFree }, 200, cors)
  } catch (err) {
    console.error('[ai-generate] Error:', err)
    return json({ error: 'Generation failed', code: 'INTERNAL' }, 500, cors)
  }
})
