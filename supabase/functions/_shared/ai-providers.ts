// AI provider + model registry for the `ai-generate` edge function.
//
// EXTENSIBILITY: every supported provider is one line in PROVIDERS below. They
// all speak the OpenAI-compatible `/chat/completions` shape, so adding one (or
// pointing at a gateway like OpenRouter) needs no code change in the handler —
// the model/provider/key are resolved here from env, per "purpose" (text vs the
// Phase-1 vision/image-recognition path). All knobs are runtime env (Supabase
// edge secrets), so switching provider/model needs NO redeploy.
//
//   AI_GENERATION_PROVIDER      provider id (default 'gemini') — picks baseUrl
//   AI_GENERATION_PROVIDER_KEY  the API key (required)
//   AI_GENERATION_BASE_URL      override baseUrl (e.g. a custom/self-hosted endpoint)
//   AI_GENERATION_MODEL         text model    (default per provider below)
//   AI_VISION_PROVIDER          provider for IMAGE reading; defaults to the text provider.
//                               Needed because DeepSeek is far cheaper per token and cannot
//                               read an image at all.
//   AI_VISION_PROVIDER_KEY      that provider's key (falls back to the text key when unset)
//   AI_VISION_MODEL_FALLBACKS   vision fallback chain, independent of the text one
//   AI_VISION_MODEL             vision model  (Phase 1; falls back to text model)
//   AI_GENERATION_MODEL_FALLBACKS  comma-separated models to try when the primary is
//                                  DAILY-exhausted (see resolveModelChain)

export interface ProviderDef {
  baseUrl: string
  // Sensible default models for this provider (overridable via env).
  textModel: string
  visionModel: string
  /**
   * Models to fall back to when the primary is exhausted for the DAY.
   *
   * Free-tier quotas are per MODEL, not per project — `gemini-2.5-flash-lite` running out
   * says nothing about `gemini-2.5-flash`. Without a chain, one model's daily cap takes
   * every AI feature down until midnight; with it, the feature degrades to a different
   * model instead of stopping.
   *
   * Ordered cheapest-first among the acceptable ones, because a fallback is charged at its
   * own rate and the learner has already been quoted a price.
   */
  textFallbacks?: string[]
  visionFallbacks?: string[]
  /**
   * How long one call to this provider may take, in ms.
   *
   * A per-provider number because latency is a property of the model family, not of our patience.
   * Gemini flash-lite answers a card prompt in a few seconds; DeepSeek's v4 line is a REASONING
   * model — the usage payload reports `reasoning_tokens` — and a three-card MCQ prompt measured
   * 23.7s against the live key. Under the shared 30s budget that aborted on anything real, and
   * the abort surfaced as AI_PROVIDER_ERROR: "지금 AI 서비스가 붐비고 있어요".
   */
  timeoutMs?: number
  /**
   * Ask this provider NOT to think out loud.
   *
   * A reasoning model spends the output budget on hidden `reasoning_content` BEFORE it writes
   * a single character of the answer, and `max_tokens` covers both. Measured on
   * deepseek-v4-flash with our real 3,000-token quiz cap: 2,847 tokens of reasoning, 153 left
   * for the JSON, `finish_reason: "length"`, and a truncated object that fails to parse —
   * which is why 서술형 quiz generation failed every single time while MCQ (a smaller answer)
   * squeaked through at 2,489.
   *
   * The same call with reasoning off: 856 completion tokens, complete valid JSON, 6.0s instead
   * of 23.0s. Our prompts already carry the structure the thinking was rediscovering each time,
   * so this is cheaper, faster and — because it stops truncating — correct.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
}

// Add a provider = add one entry. All are OpenAI-compatible.
export const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // OFF `gemini-2.5-flash-lite`. Measured against the live key: that model is served under
    // `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with a quotaValue of **20 a day**,
    // and it refused on the third request of a burst. It is a legacy model and Google has cut
    // its allowance to almost nothing; being the PRIMARY made it the first thing every AI
    // feature in the app touched.
    //
    // `gemini-3.1-flash-lite` took 30 consecutive requests without a quota error, returns the
    // declared JSON shape, and reads images. The fallbacks below are ordered so the first one
    // is exactly what production ran on today, i.e. the worst case of this change is the
    // behaviour we already had.
    //
    // `gemini-2.0-flash` and `gemini-2.0-flash-lite` were REMOVED: the API answers both with
    // 404 "no longer available", and they sat ahead of a working model in this list.
    textModel: 'gemini-3.1-flash-lite',
    visionModel: 'gemini-3.1-flash-lite',
    // Ordered CHEAPEST-FIRST, which the doc comment above this table already asked for and the
    // list did not do. It matters more than it looks: `gemini-2.5-flash` costs 3x the input and
    // 6.25x the output of the lite tier, so a chain that reaches for it first turns every
    // fallback into a margin event. Under a fixed price per action — which is where this is
    // heading — that is the difference between "degraded" and "sold at a loss".
    //
    // `gemini-flash-lite-latest` is the same tier as the primary, so falling to it costs what
    // we already priced for. `gemini-2.5-flash` stays as the last resort: it is the model
    // production actually ran on today, so it is proven, just expensive.
    textFallbacks: ['gemini-flash-lite-latest', 'gemini-2.5-flash'],
    visionFallbacks: ['gemini-flash-lite-latest', 'gemini-2.5-flash'],
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    textModel: 'grok-3',
    visionModel: 'grok-3',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    textModel: 'gpt-4.1-mini',
    visionModel: 'gpt-4.1-mini',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    // `deepseek-chat` was stale — GET /models on the live key returns exactly two ids,
    // `deepseek-v4-flash` and `deepseek-v4-pro`, and nothing else. Flash is the cheaper tier and
    // answers the JSON-object response format the quiz and card prompts depend on; pro is the
    // fallback, same key, same base URL.
    textModel: 'deepseek-v4-flash',
    textFallbacks: ['deepseek-v4-pro'],
    // Measured, not guessed: 23.7s for three MCQ cards on the live key. Three times the default
    // leaves room for a full batch without leaving a learner watching a spinner forever.
    timeoutMs: 90_000,
    // See `ProviderDef.reasoningEffort`. Without this the v4 line burns the whole output cap
    // thinking and returns a truncated object.
    reasoningEffort: 'none',
    // TEXT ONLY. `image_url` content parts are rejected outright — "unknown variant `image_url`,
    // expected `text`" — so a deployment that points vision here does not degrade, it 400s on
    // every card image. `AI_VISION_PROVIDER` exists for exactly this.
    visionModel: '',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    textModel: 'google/gemini-2.5-flash-lite',
    visionModel: 'google/gemini-2.5-flash',
  },
}

export const DEFAULT_PROVIDER = 'gemini'

export type Purpose = 'text' | 'vision'

export interface ResolvedModel {
  /** How long one call may take. Provider-specific — a reasoning model is legitimately slower. */
  timeoutMs: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  apiKey: string
  baseUrl: string
  model: string
  provider: string
}

type EnvGetter = (key: string) => string | undefined

// Pure resolver (env injected → unit-testable). Returns null when no usable
// key/baseUrl, so the handler can answer 503 instead of calling a dead endpoint.
/**
 * The primary model, then the ones to try if it is exhausted for the day.
 *
 * Same key and base URL throughout — only the model name changes, because the quota that
 * ran out is scoped to the model. `AI_GENERATION_MODEL_FALLBACKS` overrides the provider's
 * defaults without a deploy; setting it empty disables the chain entirely.
 *
 * Duplicates are removed and the primary can never appear twice, so a misconfigured env
 * cannot make the handler retry the exhausted model.
 */
export function resolveModelChain(purpose: Purpose, env: EnvGetter): ResolvedModel[] {
  const head = resolveModel(purpose, env)
  if (!head) return []

  const provider = providerFor(purpose, env)
  const def = PROVIDERS[provider]
  const raw = purpose === 'vision'
    ? (env('AI_VISION_MODEL_FALLBACKS') ?? (providerFor('text', env) === provider
        ? env('AI_GENERATION_MODEL_FALLBACKS') : undefined))
    : env('AI_GENERATION_MODEL_FALLBACKS')
  const configured = raw !== undefined
    ? raw.split(',').map((m) => m.trim()).filter(Boolean)
    : (purpose === 'vision' ? def?.visionFallbacks : def?.textFallbacks) ?? []

  const seen = new Set([head.model])
  const chain = [head]
  for (const model of configured) {
    if (seen.has(model)) continue
    seen.add(model)
    chain.push({ ...head, model })
  }
  return chain
}

/**
 * Which provider serves this purpose.
 *
 * Vision can be a DIFFERENT provider from text, and has to be: DeepSeek is several times cheaper
 * per token and cannot read an image at all — it rejects `image_url` content parts outright. One
 * global provider would mean choosing between a cheap text model and working card images.
 *
 * `AI_VISION_PROVIDER` falls back to the text provider when unset, so a deployment that has never
 * heard of this behaves exactly as it did.
 */
function providerFor(purpose: Purpose, env: EnvGetter): string {
  const text = (env('AI_GENERATION_PROVIDER') || DEFAULT_PROVIDER).trim()
  if (purpose !== 'vision') return text
  return (env('AI_VISION_PROVIDER') || text).trim()
}

export function resolveModel(purpose: Purpose, env: EnvGetter): ResolvedModel | null {
  const provider = providerFor(purpose, env)
  const def = PROVIDERS[provider]

  // The vision provider brings its own key when it is a different one; without that, pointing
  // vision at Gemini while text runs on DeepSeek would send DeepSeek's key to Google.
  const apiKey = (purpose === 'vision'
    ? (env('AI_VISION_PROVIDER_KEY') || env('AI_GENERATION_PROVIDER_KEY') || '')
    : (env('AI_GENERATION_PROVIDER_KEY') || '')).trim()
  const baseUrl = (env('AI_GENERATION_BASE_URL') || def?.baseUrl || '').trim()

  // `AI_GENERATION_MODEL` is NOT a vision fallback when the two providers differ — a text model
  // name from one provider is not a model at the other, and the request would 404 rather than
  // degrade.
  const sameProvider = providerFor('text', env) === provider
  const model = purpose === 'vision'
    ? (env('AI_VISION_MODEL')
       || (sameProvider ? env('AI_GENERATION_MODEL') : '')
       || def?.visionModel || '').trim()
    : (env('AI_GENERATION_MODEL') || def?.textModel || '').trim()

  const timeoutMs = Number(env('AI_PROVIDER_TIMEOUT_MS')) || def?.timeoutMs || 30_000

  if (!apiKey || !baseUrl || !model) return null
  return { apiKey, baseUrl, model, provider, timeoutMs, reasoningEffort: def?.reasoningEffort }
}
