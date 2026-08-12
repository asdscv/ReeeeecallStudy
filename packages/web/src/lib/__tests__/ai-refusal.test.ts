/**
 * One wallet, one refusal vocabulary.
 *
 * Measured against production before this existed. With trial spent, today's free units spent
 * and a zero balance, the four paid paths answered the SAME server condition four ways:
 *
 *   quiz setup      disabled the button and said 충전금이 부족해요. 충전하면 계속할 수 있어요.
 *   quiz run        offered the action, refused it, printed the same sentence — on the one
 *                   quiz screen with no way to 충전 anywhere on it
 *   generate        said something about a free daily card allowance that neither the quiz
 *                   nor remediation has ever had
 *   learning plan   said 크레딧이 없어 설명을 만들 수 없어요, with a top-up link added by hand
 *
 * The condition is a property of the wallet, not of the button, so it is classified once. What
 * these pin is the part a learner feels: whether they are told the truth about WHY, and whether
 * the way out is attached to the diagnosis rather than remembered per screen.
 */
import { describe, it, expect } from 'vitest'
import {
  refusalFrom, refusalMessageKey, refusalFallbackKey, isWalletRefusal,
  PAID_ACTIONS, type PaidActionId,
} from '@reeeeecall/shared/lib/ai/refusal'

/** Every code the edge function can answer a paid request with, from its own branches. */
const SERVER_CODES = [
  'AI_INSUFFICIENT_CREDITS', 'AI_RATE_CAP', 'AI_PRICE_CHANGED',
  'AI_REMEDIATION_IN_FLIGHT', 'AI_PROVIDER_ERROR', 'AI_EMPTY_RESULT',
  'AI_METER_ERROR', 'AI_PERSISTENCE_ERROR', 'BAD_REQUEST', 'FORBIDDEN',
] as const

describe('classifying a refusal', () => {
  it('knows an empty wallet, and that money fixes it', () => {
    const r = refusalFrom('AI_INSUFFICIENT_CREDITS')
    expect(r.kind).toBe('insufficient')
    expect(r.topUp).toBe(true)
    expect(isWalletRefusal(r)).toBe(true)
  })

  it('treats the client-invented quota code as the same condition', () => {
    // `ai-generate-store` mints AI_QUOTA_EXCEEDED itself when the free allowance is spent and
    // there is no balance. Same thing, different name; a learner must not get two answers.
    expect(refusalFrom('AI_QUOTA_EXCEEDED').kind).toBe('insufficient')
  })

  it('does NOT offer a top-up for the daily request cap', () => {
    // The single most important negative in this file. The cap is 300 requests a day and
    // money does not move it — a charge link here sells something that changes nothing.
    const r = refusalFrom('AI_RATE_CAP')
    expect(r.kind).toBe('rate_capped')
    expect(r.topUp).toBe(false)
    expect(isWalletRefusal(r)).toBe(false)
  })

  it('does not offer a top-up for a price change or a provider fault either', () => {
    for (const code of ['AI_PRICE_CHANGED', 'AI_PROVIDER_ERROR', 'AI_EMPTY_RESULT']) {
      expect(refusalFrom(code).topUp, code).toBe(false)
    }
  })

  it('calls a still-running request what it is, not a failure', () => {
    // Mig 212's 409. Telling the learner it failed is how they press again — the exact
    // behaviour the replay work exists to stop.
    const r = refusalFrom('AI_REMEDIATION_IN_FLIGHT')
    expect(r.kind).toBe('in_flight')
    expect(r.retryable).toBe(false)
  })

  it('never blames the wallet for something else', () => {
    // The property that matters as features are added: only the two credit codes may be
    // classified as a money problem, whatever else the server starts returning.
    for (const code of SERVER_CODES) {
      const expected = code === 'AI_INSUFFICIENT_CREDITS'
      expect(isWalletRefusal(refusalFrom(code)), code).toBe(expected)
    }
  })

  it('handles an unknown, empty or absent code without inventing a cause', () => {
    for (const input of ['SOMETHING_NEW', '', '   ', null, undefined]) {
      const r = refusalFrom(input as string)
      expect(r.kind).toBe('failed')
      expect(r.topUp).toBe(false)
    }
    expect(refusalFrom(null).code).toBe('UNKNOWN')
  })

  it('keeps the server code verbatim', () => {
    // For logs and for a future branch. A classification that discards the evidence cannot
    // be argued with later.
    expect(refusalFrom('AI_PROVIDER_ERROR').code).toBe('AI_PROVIDER_ERROR')
  })
})

describe('what the learner is told', () => {
  it('has one message per kind, not one per screen', () => {
    const keys = SERVER_CODES.map((c) => refusalMessageKey(refusalFrom(c)))
    expect(new Set(keys).size).toBeLessThanOrEqual(5)
    for (const key of keys) expect(key).toMatch(/^wallet\.refusal\./)
  })

  it('routes every kind to a key that exists in the shipped bundle', async () => {
    // The failure this catches is silent: i18next renders a missing key by echoing it, so a
    // kind added without a string would print `wallet.refusal.whatever` to a learner.
    const ko = (await import('../../../public/locales/ko/ai-generate.json')).default as
      { wallet: { refusal: Record<string, string> } }
    for (const code of SERVER_CODES) {
      const kind = refusalFrom(code).kind
      expect(ko.wallet.refusal[kind], kind).toBeTruthy()
    }
    expect(ko.wallet.refusal.retry).toBeTruthy()
  })
})

describe('the free way forward', () => {
  it('is offered for grading, which really has one', () => {
    // A refused grade still leaves 다음/마치기 beside it, and the result screen marks any
    // answered item by hand for free. A learner who is not told that reads a dead end.
    const key = refusalFallbackKey(refusalFrom('AI_INSUFFICIENT_CREDITS'), 'quiz_grade')
    expect(key).toBe('wallet.refusal.gradeYourself')
  })

  it('is NOT invented for actions without one', () => {
    for (const id of ['cards', 'image', 'image_deck', 'quiz_generate', 'remediation'] as PaidActionId[]) {
      expect(refusalFallbackKey(refusalFrom('AI_INSUFFICIENT_CREDITS'), id), id).toBeNull()
    }
  })

  it('is not offered for a refusal that is not about money', () => {
    // "You can mark it yourself for free" is an answer to "you cannot afford this", not to
    // "the provider fell over".
    expect(refusalFallbackKey(refusalFrom('AI_PROVIDER_ERROR'), 'quiz_grade')).toBeNull()
    expect(refusalFallbackKey(refusalFrom('AI_RATE_CAP'), 'quiz_grade')).toBeNull()
  })

  it('survives an unregistered action id', () => {
    expect(refusalFallbackKey(refusalFrom('AI_INSUFFICIENT_CREDITS'), undefined)).toBeNull()
    expect(refusalFallbackKey(refusalFrom('AI_INSUFFICIENT_CREDITS'),
      'not_a_feature' as PaidActionId)).toBeNull()
  })
})

describe('the registry', () => {
  it('covers every paid kind the edge function serves', () => {
    // The extension point. A fifth paid feature is a line here and inherits the message, the
    // top-up route and the retry — no screen edits.
    for (const id of ['cards', 'image', 'image_deck', 'quiz_generate', 'quiz_grade', 'remediation']) {
      expect(PAID_ACTIONS[id as PaidActionId], id).toBeDefined()
      expect(PAID_ACTIONS[id as PaidActionId].id).toBe(id)
    }
  })

  it('keeps free-fallback an exception, not a default', () => {
    const withFallback = Object.values(PAID_ACTIONS).filter((a) => a.freeFallbackKey)
    expect(withFallback.map((a) => a.id)).toEqual(['quiz_grade'])
  })
})
