/**
 * Jev (TypeSafe System One) transport — the wire types and one retrying POST.
 *
 * Shared by the quiz grader (edge function) and the daily keyword planner (Cloudflare Worker), so it
 * uses only global `fetch` and imports nothing. The key is passed in by the caller, never read here.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const JEV_PROVIDER = 'typesafe'

// ─── Wire types ─────────────────────────────────────────────────────────────

type JevCriteria = string | Record<string, unknown> | unknown[]

export type JevQuestion =
  | { readonly type: 'choice'; readonly instructions: JevCriteria; readonly criteria: Record<string, JevCriteria | null> }
  | { readonly type: 'noul'; readonly instructions: JevCriteria; readonly criteria?: { true?: JevCriteria; false?: JevCriteria } }

export interface JevRequest {
  readonly model: string
  readonly state: Record<string, unknown>
  readonly questions: Record<string, JevQuestion>
}

export type JevAnswer =
  | { readonly type: 'choice'; readonly choice: string; readonly probabilities: Record<string, number>; readonly confidence: number }
  | { readonly type: 'noul'; readonly noul: number }

export interface JevResponse {
  readonly model: string
  readonly answers: Record<string, JevAnswer>
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number } | null
}

// ─── Transport ──────────────────────────────────────────────────────────────

export interface JevCallOptions {
  readonly apiKey: string
  readonly timeoutMs?: number
  /** Backoff before each retry of a 429/529/5xx. The docs ask for backoff, not an immediate retry. */
  readonly retryDelaysMs?: readonly number[]
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529])

/**
 * POST one evaluation. Throws `JEV_<status>` / `JEV_TIMEOUT` / `JEV_BAD_RESPONSE`.
 *
 * A 4xx other than 429 is our bug (bad key, malformed question) and is not retried — retrying it
 * only spends the edge invocation before failing the same way.
 */
export async function callJev(body: JevRequest, opts: JevCallOptions): Promise<JevResponse> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const delays = opts.retryDelaysMs ?? [1000, 3000]
  let lastError: Error = new Error('JEV_ERROR')

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1])
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    let res: Response
    try {
      res = await doFetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      lastError = new Error(controller.signal.aborted ? 'JEV_TIMEOUT' : `JEV_NETWORK:${(e as Error).message}`)
      continue
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      lastError = new Error(`JEV_${res.status}`)
      if (RETRYABLE.has(res.status)) continue
      throw lastError
    }
    const parsed = await res.json().catch(() => null) as Partial<JevResponse> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.answers || typeof parsed.answers !== 'object') {
      throw new Error('JEV_BAD_RESPONSE')
    }
    return {
      model: typeof parsed.model === 'string' ? parsed.model : JEV_MODEL,
      answers: parsed.answers as Record<string, JevAnswer>,
      usage: parsed.usage && typeof parsed.usage.input_tokens === 'number' ? parsed.usage : null,
    }
  }
  throw lastError
}
