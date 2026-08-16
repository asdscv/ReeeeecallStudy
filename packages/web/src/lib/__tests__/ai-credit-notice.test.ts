/**
 * "크레딧이 있어야 쓸 수 있어요" — one sentence, one rule, every AI surface.
 *
 * The line existed twice before this: `AIHubPage` and the generate screen's `ConfigStep` each
 * built it inline, the second carrying a comment claiming it used "the same wording as the
 * generate screen's wallet line". Two copies of a sentence is how they stop being the same
 * sentence. Meanwhile the quiz screens spend the same wallet and said nothing at all, so a
 * learner could reach a paid action from a screen that had never mentioned credits.
 *
 * The property that matters most here is the last one: a feature registered in the catalog is
 * covered without editing anything. That is what makes the notice extensible rather than a
 * list someone has to remember to append to.
 */
import { describe, it, expect } from 'vitest'
import {
  creditNotice, aiFeatureRequiresCredits,
} from '@reeeeecall/shared/lib/ai/credit-notice'
import {
  aiHubEntries, AI_HUB_QUIZ, AI_HUB_GENERATE, AI_HUB_LEARNING_PLAN,
} from '@reeeeecall/shared/lib/ai/hub/catalog'

const money = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`

describe('which features need credits', () => {
  it('covers every model-backed feature, without naming one', () => {
    // The extension point. A fourth entry registered with `poweredBy: 'model'` is covered by
    // this rule and by both platforms' components, with no edit to either.
    const model = aiHubEntries().filter((e) => e.poweredBy === 'model')
    expect(model.length).toBeGreaterThan(0)
    for (const entry of model) {
      expect(aiFeatureRequiresCredits(entry.id), entry.id).toBe(true)
    }
  })

  it('says nothing about a feature that spends nothing', () => {
    // The learning plan runs on the device. A credit notice there is a line the learner has to
    // learn to ignore, which is how they learn to ignore the one that matters.
    expect(aiFeatureRequiresCredits(AI_HUB_LEARNING_PLAN)).toBe(false)
  })

  it('treats an unknown id as spending nothing', () => {
    // A stale deep link or a persisted id from an older build must not invent a warning.
    expect(aiFeatureRequiresCredits('not_a_feature')).toBe(false)
    expect(aiFeatureRequiresCredits('')).toBe(false)
  })

  it('covers the two screens the report was about', () => {
    expect(aiFeatureRequiresCredits(AI_HUB_QUIZ)).toBe(true)
    expect(aiFeatureRequiresCredits(AI_HUB_GENERATE)).toBe(true)
  })
})

describe('creditNotice', () => {
  it('says nothing while the wallet is still being read', () => {
    // A notice that flickers "잔액 없음" during load sends a learner to the payment screen for
    // a problem they do not have.
    expect(creditNotice(undefined, money)).toBeNull()
  })

  it('does not call a failed read an empty wallet', () => {
    // The distinction the whole module turns on: `null` is "we could not tell", which is not
    // "you have nothing".
    const n = creditNotice(null, money)!
    expect(n.tone).toBe('unknown')
    expect(n.key).toBe('wallet.unknown')
  })

  it('names the free allowance and the balance when both exist', () => {
    const n = creditNotice({ balanceMicroUsd: 2_500_000, freeRemainingToday: 3 }, money)!
    expect(n.tone).toBe('ok')
    expect(n.key).toBe('wallet.freeOnly')
    expect(n.params).toEqual({ free: 3 })
    expect(n.secondKey).toBe('wallet.balance')
    expect(n.secondParams).toEqual({ amount: '$2.50' })
  })

  it('names only what there is', () => {
    const freeOnly = creditNotice({ balanceMicroUsd: 0, freeRemainingToday: 3 }, money)!
    expect(freeOnly.key).toBe('wallet.freeOnly')
    expect(freeOnly.secondKey).toBeNull()

    const balanceOnly = creditNotice({ balanceMicroUsd: 1_000_000, freeRemainingToday: 0 }, money)!
    expect(balanceOnly.key).toBe('wallet.balance')
    expect(balanceOnly.secondKey).toBeNull()
  })

  it('is the requirement notice when there is nothing to spend', () => {
    // The state the feature exists for, and the only one that asks the learner for anything.
    const n = creditNotice({ balanceMicroUsd: 0, freeRemainingToday: 0 }, money)!
    expect(n.tone).toBe('empty')
    expect(n.key).toBe('wallet.needsCredits')
  })

  it('treats a missing free count as no free allowance', () => {
    // Surfaces without a free tier omit the field; absent must not read as unlimited.
    const n = creditNotice({ balanceMicroUsd: 0 }, money)!
    expect(n.tone).toBe('empty')
  })

  it('never reads a negative balance as something to spend', () => {
    // A clawback can drive a wallet below zero. "-$1.20 available" is not a sentence.
    const n = creditNotice({ balanceMicroUsd: -1_200_000, freeRemainingToday: 0 }, money)!
    expect(n.tone).toBe('empty')
  })

  it('never states a price', () => {
    // Amounts were removed from the flow on purpose. The BALANCE is a lookup; a per-action
    // price is the thing this notice must not become.
    for (const wallet of [
      { balanceMicroUsd: 0, freeRemainingToday: 0 },
      { balanceMicroUsd: 5_000_000, freeRemainingToday: 2 },
    ]) {
      const n = creditNotice(wallet, money)!
      for (const key of [n.key, n.secondKey].filter(Boolean) as string[]) {
        expect(key, key).not.toMatch(/price|cost|per|unit/i)
      }
    }
  })
})


/**
 * The notice reports THIS screen's allowance, not always the card one.
 *
 * Found on a device: the quiz setup screen showed "오늘 남은 무료 카드 10장" across the top and
 * "오늘 무료 문항 3/5개 남음" at the bottom. Two numbers, two different features, and the bigger
 * and more prominent one was about the other one. The call sites already passed `featureId` —
 * the notice was simply not asking the catalog what that feature spends.
 */
describe('the allowance the screen is actually about', () => {
  const wallet = { balanceMicroUsd: 0, freeRemainingToday: 10, quizFreeRemainingToday: 3 }

  it('reports questions on a quiz surface and cards on a generate surface', () => {
    expect(creditNotice(wallet, money, AI_HUB_QUIZ)!.key).toBe('wallet.freeQuizOnly')
    expect(creditNotice(wallet, money, AI_HUB_QUIZ)!.params.free).toBe(3)

    expect(creditNotice(wallet, money, AI_HUB_GENERATE)!.key).toBe('wallet.freeOnly')
    expect(creditNotice(wallet, money, AI_HUB_GENERATE)!.params.free).toBe(10)
  })

  it('says "nothing left" on a quiz screen whose QUESTIONS are spent, even with cards to spare', () => {
    // The case that made this wrong the other way round: ten free cards left is not permission
    // to make a free quiz question.
    const n = creditNotice({ balanceMicroUsd: 0, freeRemainingToday: 10, quizFreeRemainingToday: 0 },
      money, AI_HUB_QUIZ)!
    expect(n.tone).toBe('empty')
    expect(n.key).toBe('wallet.needsCredits')
  })

  it('every model-backed catalog entry declares which allowance it spends', () => {
    // The extension point again: a fourth AI feature cannot be registered without saying what it
    // draws on, so it cannot silently inherit the card number the way quiz did.
    for (const entry of aiHubEntries().filter((e) => e.poweredBy === 'model')) {
      expect(entry.spends, entry.id).not.toBeNull()
    }
    // And one that spends nothing says so, rather than being omitted.
    const plan = aiHubEntries().find((e) => e.id === AI_HUB_LEARNING_PLAN)!
    expect(plan.spends).toBeNull()
  })

  it('falls back to the card allowance for an unknown id rather than showing nothing', () => {
    // A stale deep link should degrade to the oldest surface, not to a blank row.
    expect(creditNotice(wallet, money, 'no_such_feature')!.key).toBe('wallet.freeOnly')
    // And an omitted id keeps the pre-existing behaviour for any caller not yet updated.
    expect(creditNotice(wallet, money)!.key).toBe('wallet.freeOnly')
  })
})
