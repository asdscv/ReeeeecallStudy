// Verifies the edge function's provider/model registry resolver — the seam that
// makes provider/model "easily extensible" (env-driven, no code change to switch).
import { describe, it, expect } from 'vitest'
import { resolveModel, PROVIDERS } from '../../../../../../supabase/functions/_shared/ai-providers'

const env = (m: Record<string, string>) => (k: string) => m[k]

describe('resolveModel — provider/model registry', () => {
  it('defaults to gemini text model with just a key', () => {
    expect(resolveModel('text', env({ AI_GENERATION_PROVIDER_KEY: 'k' }))).toEqual({
      apiKey: 'k', baseUrl: PROVIDERS.gemini.baseUrl, model: PROVIDERS.gemini.textModel, provider: 'gemini',
    })
  })

  it('switches provider by name (xai) → its baseUrl + default model, no code change', () => {
    const r = resolveModel('text', env({ AI_GENERATION_PROVIDER: 'xai', AI_GENERATION_PROVIDER_KEY: 'k' }))
    expect(r?.baseUrl).toBe(PROVIDERS.xai.baseUrl)
    expect(r?.model).toBe(PROVIDERS.xai.textModel)
  })

  it('honors AI_GENERATION_MODEL override', () => {
    expect(resolveModel('text', env({ AI_GENERATION_PROVIDER_KEY: 'k', AI_GENERATION_MODEL: 'custom' }))?.model).toBe('custom')
  })

  it('vision purpose uses the vision model; AI_VISION_MODEL overrides', () => {
    expect(resolveModel('vision', env({ AI_GENERATION_PROVIDER_KEY: 'k' }))?.model).toBe(PROVIDERS.gemini.visionModel)
    expect(resolveModel('vision', env({ AI_GENERATION_PROVIDER_KEY: 'k', AI_VISION_MODEL: 'v-model' }))?.model).toBe('v-model')
  })

  it('AI_GENERATION_BASE_URL overrides the registry baseUrl (custom/self-hosted)', () => {
    expect(resolveModel('text', env({ AI_GENERATION_PROVIDER_KEY: 'k', AI_GENERATION_BASE_URL: 'https://x/y' }))?.baseUrl).toBe('https://x/y')
  })

  it('returns null without a key (→ 503 not configured)', () => {
    expect(resolveModel('text', env({}))).toBeNull()
  })

  it('returns null for an unknown provider with no base-url override', () => {
    expect(resolveModel('text', env({ AI_GENERATION_PROVIDER: 'nope', AI_GENERATION_PROVIDER_KEY: 'k' }))).toBeNull()
  })
})
