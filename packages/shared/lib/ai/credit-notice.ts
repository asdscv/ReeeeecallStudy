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

/** The wallet fields the notice reads. A subset of `AiWalletSummary`, so either shape fits. */
export interface CreditNoticeWallet {
  /** Prepaid balance, micro-USD. */
  readonly balanceMicroWon: number
  /** Card generations still free today. Absent on surfaces with no free tier. */
  readonly freeRemainingToday?: number
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
): CreditNotice | null {
  if (wallet === undefined) return null
  // A failed read is NOT an empty wallet. Saying "you have nothing" on a network blip sends a
  // learner to the payment screen for a problem they do not have.
  if (wallet === null) {
    return { tone: 'unknown', key: 'wallet.unknown', params: {}, secondKey: null, secondParams: {} }
  }

  const free = Math.max(0, Number(wallet.freeRemainingToday ?? 0))
  const balance = Math.max(0, Number(wallet.balanceMicroWon ?? 0))

  if (free > 0 && balance > 0) {
    return {
      tone: 'ok',
      key: 'wallet.freeOnly', params: { free },
      secondKey: 'wallet.balance', secondParams: { amount: formatAmount(balance) },
    }
  }
  if (free > 0) {
    return { tone: 'ok', key: 'wallet.freeOnly', params: { free }, secondKey: null, secondParams: {} }
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
