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

export interface ProviderDef {
  baseUrl: string
  // Sensible default models for this provider (overridable via env).
  textModel: string
  visionModel: string
}

// Add a provider = add one entry. All are OpenAI-compatible.
export const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    textModel: 'gemini-2.5-flash-lite',
    visionModel: 'gemini-2.5-flash',
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
