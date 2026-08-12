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
    textFallbacks: ['gemini-2.5-flash', 'gemini-flash-lite-latest'],
    visionFallbacks: ['gemini-2.5-flash'],
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
    textModel: 'deepseek-chat',
    visionModel: 'deepseek-chat',
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

  const provider = (env('AI_GENERATION_PROVIDER') || DEFAULT_PROVIDER).trim()
  const def = PROVIDERS[provider]
  const raw = env('AI_GENERATION_MODEL_FALLBACKS')
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

export function resolveModel(purpose: Purpose, env: EnvGetter): ResolvedModel | null {
  const provider = (env('AI_GENERATION_PROVIDER') || DEFAULT_PROVIDER).trim()
  const def = PROVIDERS[provider]

  const apiKey = (env('AI_GENERATION_PROVIDER_KEY') || '').trim()
  const baseUrl = (env('AI_GENERATION_BASE_URL') || def?.baseUrl || '').trim()

  const model = purpose === 'vision'
    ? (env('AI_VISION_MODEL') || env('AI_GENERATION_MODEL') || def?.visionModel || '').trim()
    : (env('AI_GENERATION_MODEL') || def?.textModel || '').trim()

  if (!apiKey || !baseUrl || !model) return null
  return { apiKey, baseUrl, model, provider }
}
