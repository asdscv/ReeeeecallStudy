/**
 * The model fallback chain.
 *
 * Free-tier quotas are per MODEL, not per project: `gemini-2.5-flash-lite` running out says
 * nothing about `gemini-2.0-flash`. The live key is on the free tier at **20 requests a day**,
 * so without a chain one model's cap takes every AI feature down until midnight — which is not
 * a hypothetical, it is what happened.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveModel, resolveModelChain, PROVIDERS,
} from '../../../../../supabase/functions/_shared/ai-providers.ts'

const env = (over: Record<string, string> = {}) => (k: string): string | undefined =>
  ({ AI_GENERATION_PROVIDER_KEY: 'k', ...over })[k]

describe('resolveModelChain', () => {
  it('leads with the primary and follows with the provider defaults', () => {
    const chain = resolveModelChain('text', env())

    expect(chain[0].model).toBe(PROVIDERS.gemini.textModel)
    expect(chain.map((m) => m.model).slice(1)).toEqual(PROVIDERS.gemini.textFallbacks)
    // Same key and endpoint throughout: the quota that ran out is scoped to the MODEL.
    expect(new Set(chain.map((m) => m.baseUrl)).size).toBe(1)
    expect(new Set(chain.map((m) => m.apiKey)).size).toBe(1)
  })

  it('never repeats the exhausted model', () => {
    // A misconfigured env that names the primary among the fallbacks would otherwise make the
    // handler retry the model it just gave up on, spending a request to learn nothing.
    const chain = resolveModelChain('text', env({
      AI_GENERATION_MODEL: 'gemini-2.0-flash',
      AI_GENERATION_MODEL_FALLBACKS: 'gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-flash',
    }))

    expect(chain.map((m) => m.model)).toEqual(['gemini-2.0-flash', 'gemini-2.5-flash'])
  })

  it('can be turned off without a deploy', () => {
    // An empty override is a deliberate "primary only" — distinct from the variable being
    // unset, which means "use the provider's defaults".
    expect(resolveModelChain('text', env({ AI_GENERATION_MODEL_FALLBACKS: '' })))
      .toHaveLength(1)
    expect(resolveModelChain('text', env()).length).toBeGreaterThan(1)
  })

  it('uses the vision chain for vision', () => {
    const chain = resolveModelChain('vision', env())

    expect(chain[0].model).toBe(PROVIDERS.gemini.visionModel)
    expect(chain.map((m) => m.model).slice(1)).toEqual(PROVIDERS.gemini.visionFallbacks)
  })

  it('is empty exactly when resolveModel is null', () => {
    // No key → the handler answers 503 rather than calling a dead endpoint, and the chain must
    // not paper over that with fallbacks that are equally dead.
    const noKey = (k: string) => (k === 'AI_GENERATION_PROVIDER_KEY' ? '' : undefined)

    expect(resolveModel('text', noKey)).toBeNull()
    expect(resolveModelChain('text', noKey)).toEqual([])
  })

  it('gives every provider in the registry a resolvable primary', () => {
    for (const id of Object.keys(PROVIDERS)) {
      const chain = resolveModelChain('text', env({ AI_GENERATION_PROVIDER: id }))
      expect(chain.length, id).toBeGreaterThan(0)
      expect(chain[0].model, id).toBe(PROVIDERS[id].textModel)
    }
  })
})

/**
 * A dead model in the chain took every AI feature down with it.
 *
 * Found by driving production: 퀴즈 만들기 answered "지금 AI 서비스가 붐비고 있어요", and calling
 * the provider directly showed why —
 *
 *   gemini-2.5-flash-lite   429 RESOURCE_EXHAUSTED   (free tier, 20 requests/day)
 *   gemini-2.0-flash-lite   404 NOT_FOUND            (decommissioned)
 *   gemini-2.0-flash        404 NOT_FOUND            (decommissioned)
 *   gemini-2.5-flash        OK
 *
 * The chain existed precisely so one model's daily cap could not do this. It failed because
 * `generate()` walked on only for a daily-quota error: the primary was correctly skipped, the
 * first FALLBACK answered 404, that is not a quota error, and the loop rethrew — never reaching
 * the model that worked. Two dead entries stood between the outage and the fix.
 */
describe('the fallback chain after two models were decommissioned', () => {
  it('lists no model the API has retired', () => {
    // Verified against the live API. Both 2.0 entries answer 404 "no longer available".
    const RETIRED = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
    const gemini = PROVIDERS.gemini
    for (const dead of RETIRED) {
      expect(gemini.textFallbacks ?? [], `text: ${dead}`).not.toContain(dead)
      expect(gemini.visionFallbacks ?? [], `vision: ${dead}`).not.toContain(dead)
      expect(gemini.textModel, `primary: ${dead}`).not.toBe(dead)
      expect(gemini.visionModel, `vision primary: ${dead}`).not.toBe(dead)
    }
  })

  it('still has somewhere to fall back to', () => {
    // Removing the dead entries must not leave the primary alone — that is the outage again,
    // just without the misleading 404 in the middle.
    const gemini = PROVIDERS.gemini
    expect((gemini.textFallbacks ?? []).length).toBeGreaterThan(0)
    expect((gemini.visionFallbacks ?? []).length).toBeGreaterThan(0)
  })

  it('never falls back to the model it just gave up on', () => {
    const gemini = PROVIDERS.gemini
    expect(gemini.textFallbacks ?? []).not.toContain(gemini.textModel)
    expect(gemini.visionFallbacks ?? []).not.toContain(gemini.visionModel)
  })
})
