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

/**
 * The primary must not be a model Google has stopped funding.
 *
 * Measured against the live key: `gemini-2.5-flash-lite` is served under
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with a quotaValue of **20 per day**, and
 * refused on the third request of a burst. It was the PRIMARY — the first thing every AI
 * feature in the app touched — so twenty requests took the whole product down for a day.
 *
 * `gemini-3.1-flash-lite` took thirty consecutive requests with no quota error on the same key.
 * The lesson is not "this model is good" but "a pinned model rots": two entries in this chain
 * had already been decommissioned, and a third had its allowance cut to nothing, all while the
 * code kept pointing at them.
 */
describe('the primary model', () => {
  it('is not the model measured at 20 requests a day', () => {
    expect(PROVIDERS.gemini.textModel).not.toBe('gemini-2.5-flash-lite')
    expect(PROVIDERS.gemini.visionModel).not.toBe('gemini-2.5-flash-lite')
  })

  it('is not retired, in any position of either chain', () => {
    const RETIRED = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
    const g = PROVIDERS.gemini
    const everything = [g.textModel, g.visionModel, ...(g.textFallbacks ?? []), ...(g.visionFallbacks ?? [])]
    for (const dead of RETIRED) expect(everything, dead).not.toContain(dead)
  })

  it('keeps the model production actually ran on somewhere in the chain', () => {
    // `gemini-2.5-flash` served the 12-question quiz on the day the primary was repointed, so
    // it is the proven last resort. It is deliberately NOT first: it costs 3x the input and
    // 6.25x the output of the lite tier, and reaching for it before a same-tier model turns
    // every fallback into a margin event. See the ordering tests below.
    expect(PROVIDERS.gemini.textFallbacks).toContain('gemini-2.5-flash')
    expect(PROVIDERS.gemini.visionFallbacks).toContain('gemini-2.5-flash')
  })
})

/**
 * The chain must degrade to something CHEAPER, never pricier.
 *
 * `gemini-2.5-flash` costs 3x the input and 6.25x the output of the flash-lite tier. With the
 * expensive model as the first fallback, every exhaustion of the primary tripled or sextupled
 * the cost of the work while the learner paid the same — and under a fixed price per action,
 * which is where the billing is heading, that is selling below cost rather than merely earning
 * less. The doc comment on this table already said "ordered cheapest-first among the
 * acceptable ones"; the list did not do it.
 *
 * Rates are the ones in `ai_pricing_config`, in micro-USD per million tokens.
 */
describe('fallback ordering', () => {
  const RATE: Record<string, { in: number; out: number }> = {
    'gemini-3.1-flash-lite': { in: 100_000, out: 400_000 },
    'gemini-flash-lite-latest': { in: 100_000, out: 400_000 },
    'gemini-2.5-flash': { in: 300_000, out: 2_500_000 },
  }
  /** A representative blend: our measured usage is roughly 2 parts input to 1 part output. */
  const blended = (m: string) => RATE[m] ? RATE[m].in * 2 + RATE[m].out : null

  it('never puts a pricier model ahead of a cheaper one', () => {
    for (const chain of [
      [PROVIDERS.gemini.textModel, ...(PROVIDERS.gemini.textFallbacks ?? [])],
      [PROVIDERS.gemini.visionModel, ...(PROVIDERS.gemini.visionFallbacks ?? [])],
    ]) {
      const priced = chain.map(blended)
      for (let i = 1; i < priced.length; i++) {
        const prev = priced[i - 1], cur = priced[i]
        if (prev === null || cur === null) continue // unpriced is caught by its own test
        expect(cur, `${chain[i]} after ${chain[i - 1]}`).toBeGreaterThanOrEqual(prev)
      }
    }
  })

  it('reaches a same-tier model before an expensive one', () => {
    // The specific regression: the first thing tried after the primary should cost what we
    // priced for, not 3-6x it.
    const first = PROVIDERS.gemini.textFallbacks?.[0]
    expect(blended(first!)).toBe(blended(PROVIDERS.gemini.textModel))
  })
})

/**
 * Text on one provider, images on another.
 *
 * DeepSeek is several times cheaper per token and cannot read an image at all — it answers an
 * `image_url` content part with "unknown variant `image_url`, expected `text`". With one global
 * provider the choice was between a cheap text model and working card images, so vision gets its
 * own provider, key and fallback chain, each defaulting to the text one when unset.
 */
describe('vision can run on a different provider from text', () => {
  const split = {
    AI_GENERATION_PROVIDER: 'deepseek',
    AI_GENERATION_PROVIDER_KEY: 'ds-key',
    AI_VISION_PROVIDER: 'gemini',
    AI_VISION_PROVIDER_KEY: 'gm-key',
  }

  it('sends each purpose to its own provider, base url and key', () => {
    const text = resolveModel('text', env(split))
    expect(text).toMatchObject({ provider: 'deepseek', apiKey: 'ds-key' })
    expect(text?.baseUrl).toContain('deepseek.com')
    expect(text?.model).toBe('deepseek-v4-flash')

    const vision = resolveModel('vision', env(split))
    expect(vision).toMatchObject({ provider: 'gemini', apiKey: 'gm-key' })
    expect(vision?.baseUrl).toContain('googleapis.com')
  })

  it('never sends one provider\'s key to the other', () => {
    // The failure this guards is silent and expensive: Google would reject DeepSeek's key with a
    // 401 that reads as "AI is down".
    const vision = resolveModel('vision', env(split))
    expect(vision?.apiKey).not.toBe('ds-key')
  })

  it('does not use the TEXT model name for vision across providers', () => {
    // `AI_GENERATION_MODEL` names a model at the text provider. Reused at another provider it is
    // a 404, not a degraded call.
    const vision = resolveModel('vision', env({ ...split, AI_GENERATION_MODEL: 'deepseek-v4-pro' }))
    expect(vision?.model).not.toBe('deepseek-v4-pro')
    expect(vision?.model).toContain('gemini')
  })

  it('keeps the old single-provider behaviour when vision is not configured', () => {
    const only = { AI_GENERATION_PROVIDER: 'gemini', AI_GENERATION_PROVIDER_KEY: 'k' }
    const vision = resolveModel('vision', env(only))
    expect(vision).toMatchObject({ provider: 'gemini', apiKey: 'k' })
    // And the text model override still reaches vision, because it IS the same provider.
    expect(resolveModel('vision', env({ ...only, AI_GENERATION_MODEL: 'gemini-2.5-flash' }))?.model)
      .toBe('gemini-2.5-flash')
  })

  it('falls back within the vision provider, not into the text one', () => {
    const chain = resolveModelChain('vision', env(split))
    expect(chain.length).toBeGreaterThan(1)
    expect(chain.every((m) => m.provider === 'gemini')).toBe(true)
    expect(chain.every((m) => m.model.startsWith('gemini'))).toBe(true)
  })

  it('gives DeepSeek the two models the API actually lists', () => {
    // `deepseek-chat` was in this table and is not in `GET /models` — the live key returns
    // exactly `deepseek-v4-flash` and `deepseek-v4-pro`.
    expect(PROVIDERS.deepseek.textModel).toBe('deepseek-v4-flash')
    expect(PROVIDERS.deepseek.textFallbacks).toEqual(['deepseek-v4-pro'])
    // Empty on purpose: pointing vision here would 400 on every card image.
    expect(PROVIDERS.deepseek.visionModel).toBe('')
  })
})
