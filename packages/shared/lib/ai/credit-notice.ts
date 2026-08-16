/**
 * "크레딧이 있어야 쓸 수 있어요" — one sentence, one rule, every AI surface.
 *
 * The line already existed twice: `AIHubPage` and the generate screen's `ConfigStep` each
 * built it inline, and the second one carries a comment saying "same wording as the generate
 * screen's wallet line". Two copies of a sentence is how they stop being the same sentence.
 * Meanwhile the quiz screens — which spend the same wallet — said nothing at all, so a learner
 * could reach a paid action from a screen that had never mentioned credits.
 *
 * ## Why this is a function of the WALLET and not of the screen
 *
 * The notice is never "this costs money". That claim was deliberately removed from the flow
 * (see the quiz setup and grading screens): a learner is not told an amount before acting.
 * What is left is the one fact they cannot act around — whether they have anything to spend —
 * which is a property of the wallet, not of the button they are looking at.
 *
 * ## Extending
 *
 * A new AI feature registers in `hub/catalog.ts` with `poweredBy: 'model'` and is covered by
 * {@link aiFeatureRequiresCredits} without editing this file. `poweredBy: 'device'` — the
 * learning plan — is not covered, because nothing there spends anything.
 */
import { aiHubEntryFor } from './hub/catalog'
import type { AiHubSpends } from './hub/types'

/** The wallet fields the notice reads. A subset of `AiWalletSummary`, so either shape fits. */
export interface CreditNoticeWallet {
  /** Prepaid balance, micro-USD. */
  readonly balanceMicroUsd: number
  /** Card generations still free today. Absent on surfaces with no free tier. */
  readonly freeRemainingToday?: number
  /** Quiz QUESTIONS still free today, any type (mig 239). */
  readonly quizFreeRemainingToday?: number
}

export type CreditNoticeTone =
  /** Something is available — free allowance, balance, or both. */
  | 'ok'
  /** Nothing left to spend. The one state a learner has to act on. */
  | 'empty'
  /** The wallet could not be read. Never rendered as "you have nothing". */
  | 'unknown'

export interface CreditNotice {
  tone: CreditNoticeTone
  /** i18n key in the `ai-generate` namespace, which exists on both platforms in all 8 locales. */
  key: string
  /** Interpolation for `key`. `amount` is pre-formatted by the caller — see below. */
  params: Record<string, string | number>
  /** A second key, joined with " · ". Null when the first line says everything. */
  secondKey: string | null
  secondParams: Record<string, string | number>
}

/**
 * Whether an AI feature spends credits at all.
 *
 * Derived from the catalog rather than passed in, so a screen cannot claim a cost it does not
 * have — or, worse, stay silent about one it does. An unknown id is treated as NOT spending:
 * a stale deep link should not invent a warning.
 */
export function aiFeatureRequiresCredits(entryId: string): boolean {
  return aiHubEntryFor(entryId)?.poweredBy === 'model'
}

/**
 * Which daily allowance this screen's feature draws on, from the catalog.
 *
 * An unknown id reports `'card'` rather than nothing: the generate flow is the oldest caller and
 * the one a stale id is most likely to be, and a wrong-but-present number is easier to notice
 * than a silently missing line.
 */
function spendsOf(entryId: string | undefined): AiHubSpends {
  if (entryId === undefined) return 'card'
  const entry = aiHubEntryFor(entryId)
  return entry ? entry.spends : 'card'
}

/**
 * The notice for a wallet, or `null` when there is nothing to say.
 *
 * `formatAmount` is injected because the two platforms format micro-USD through the same
 * helper but the notice must stay free of it — this module is pure so both platforms and the
 * tests can share one rule.
 *
 * `undefined` wallet means "not read yet" and returns null: a skeleton is the caller's job,
 * and a notice that flickers "잔액 없음" during load is worse than a moment of nothing.
 */
export function creditNotice(
  wallet: CreditNoticeWallet | null | undefined,
  formatAmount: (micro: number) => string,
  entryId?: string,
): CreditNotice | null {
  if (wallet === undefined) return null
  // A failed read is NOT an empty wallet. Saying "you have nothing" on a network blip sends a
  // learner to the payment screen for a problem they do not have.
  if (wallet === null) {
    return { tone: 'unknown', key: 'wallet.unknown', params: {}, secondKey: null, secondParams: {} }
  }

  // THE ALLOWANCE THAT BELONGS TO THIS SCREEN.
  //
  // It used to always be the card allowance, on every AI surface. So a learner setting up a quiz
  // read "오늘 남은 무료 카드 10장" at the top of the form and "오늘 무료 문항 3/5개 남음" at
  // the bottom of it — two numbers, two different features, and the larger and more prominent one
  // was about the other one. The catalog already knew which feature the screen was; it just was
  // not being asked.
  const spends = spendsOf(entryId)
  const free = spends === 'quiz_generate'
    ? Math.max(0, Number(wallet.quizFreeRemainingToday ?? 0))
    : spends === 'card' ? Math.max(0, Number(wallet.freeRemainingToday ?? 0))
    : 0
  const freeKey = spends === 'quiz_generate' ? 'wallet.freeQuizOnly' : 'wallet.freeOnly'
  const balance = Math.max(0, Number(wallet.balanceMicroUsd ?? 0))

  if (free > 0 && balance > 0) {
    return {
      tone: 'ok',
      key: freeKey, params: { free },
      secondKey: 'wallet.balance', secondParams: { amount: formatAmount(balance) },
    }
  }
  if (free > 0) {
    return { tone: 'ok', key: freeKey, params: { free }, secondKey: null, secondParams: {} }
  }
  if (balance > 0) {
    return {
      tone: 'ok',
      key: 'wallet.balance', params: { amount: formatAmount(balance) },
      secondKey: null, secondParams: {},
    }
  }
  // Nothing free left and nothing to spend. This is the notice the feature exists for.
  return { tone: 'empty', key: 'wallet.needsCredits', params: {}, secondKey: null, secondParams: {} }
}
