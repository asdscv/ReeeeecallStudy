/**
 * One wallet, one refusal vocabulary.
 *
 * Every paid feature in this app ends at the same four SQLSTATEs and the same handful of edge
 * function codes. Until now each surface re-decided, independently, what they meant and what
 * the learner could do about them — and they disagreed:
 *
 *   * the quiz SETUP screen disabled the button and explained why before anything was sent;
 *   * the quiz RUN screen, mid-session, offered the paid action, refused it, and printed
 *     "충전하면 계속할 수 있어요" — on the one quiz screen carrying no way to 충전;
 *   * the generate screen mapped it to a sentence about a free daily card allowance that
 *     neither remediation nor the quiz possesses;
 *   * the learning plan printed a third sentence and, until it was patched by hand, offered
 *     no route out either.
 *
 * The condition is a property of the WALLET, not of the button. So it is classified once, here,
 * and each platform has exactly one component that renders the result. A fifth paid feature
 * registers an id and inherits the message, the top-up route and the retry.
 *
 * ## What this deliberately does NOT do
 *
 * It does not price anything. The four `reserve_ai_*` SQL functions have genuinely different
 * economics — a free-card split, a bare boolean gate, a unit ledger with outstanding holds, an
 * always-paid replay — and collapsing them would put the quiz's hold accounting and the card
 * allowance in one plpgsql body. The kernel gates and translates; it must not price.
 */

/** Every paid surface, by the id its edge-function request already uses. */
export type PaidActionId =
  | 'cards'
  | 'image'
  | 'image_deck'
  | 'quiz_generate'
  | 'quiz_grade'
  | 'remediation'

export interface PaidAction {
  readonly id: PaidActionId
  /**
   * Whether the learner can carry on WITHOUT paying, and the key that says how.
   *
   * Only the quiz has one: a refused grade still leaves 다음/마치기 beside it, and the result
   * screen marks any answered item by hand for free. Saying so is the difference between a
   * dead end and a detour, and it is a fact about the feature, so it is registered rather
   * than re-derived by each screen.
   */
  readonly freeFallbackKey?: string
}

/**
 * The registry. Adding a paid feature is a line here.
 *
 * Keyed by the `kind`/action already on the wire, so nothing has to be kept in sync by hand.
 */
export const PAID_ACTIONS: Readonly<Record<PaidActionId, PaidAction>> = {
  cards: { id: 'cards' },
  image: { id: 'image' },
  image_deck: { id: 'image_deck' },
  quiz_generate: { id: 'quiz_generate' },
  // The one action a learner can complete without paying — see `freeFallbackKey` above.
  quiz_grade: { id: 'quiz_grade', freeFallbackKey: 'wallet.refusal.gradeYourself' },
  remediation: { id: 'remediation' },
}

export type AiRefusalKind =
  /** Nothing left to spend. The only one the learner can fix, and the only one with a route. */
  | 'insufficient'
  /** The daily request cap, which topping up does not lift. Saying "충전하세요" here would lie. */
  | 'rate_capped'
  /** The same request is already running. Not an error; the answer is to wait. */
  | 'in_flight'
  /** The quoted price no longer holds. Re-quoting is the fix, not paying. */
  | 'price_changed'
  /** Anything else — a provider fault, a bad request. Never blamed on the wallet. */
  | 'failed'

export interface AiRefusal {
  readonly kind: AiRefusalKind
  /** The server's own code, kept verbatim for logs and for tests to pin. */
  readonly code: string
  /** Is topping up the fix? True for exactly one kind, which is the point of the type. */
  readonly topUp: boolean
  /** Is pressing again, unchanged, worth anything? */
  readonly retryable: boolean
}

/**
 * The one mapping.
 *
 * Codes come from `supabase/functions/ai-generate/index.ts`, which is itself translating the
 * SQLSTATEs the four reserve functions raise: P0002 -> AI_INSUFFICIENT_CREDITS, 23514 ->
 * AI_RATE_CAP, P0008 -> AI_PRICE_CHANGED, 55006 -> AI_REMEDIATION_IN_FLIGHT.
 *
 * `AI_QUOTA_EXCEEDED` is here because the generate store invents it client-side when the free
 * allowance is spent and there is no balance; it is the same condition under a different name.
 */
export function refusalFrom(code: string | null | undefined): AiRefusal {
  const value = typeof code === 'string' ? code.trim() : ''
  switch (value) {
    case 'AI_INSUFFICIENT_CREDITS':
    case 'AI_QUOTA_EXCEEDED':
      return { kind: 'insufficient', code: value, topUp: true, retryable: true }
    case 'AI_RATE_CAP':
      // Deliberately NOT topUp. The cap is 300 requests a day and money does not move it;
      // offering a charge link here would sell something that changes nothing.
      return { kind: 'rate_capped', code: value, topUp: false, retryable: false }
    case 'AI_REMEDIATION_IN_FLIGHT':
      return { kind: 'in_flight', code: value, topUp: false, retryable: false }
    case 'AI_PRICE_CHANGED':
      return { kind: 'price_changed', code: value, topUp: false, retryable: true }
    default:
      return { kind: 'failed', code: value || 'UNKNOWN', topUp: false, retryable: true }
  }
}

/** True when the wallet is the reason. The predicate screens used to spell out inline. */
export function isWalletRefusal(refusal: AiRefusal): boolean {
  return refusal.kind === 'insufficient'
}

/**
 * The i18n key for a refusal, in the `ai-generate` namespace — the one namespace both
 * platforms already load on every paid surface.
 *
 * One key per kind, not one per screen. Three screens had three Korean sentences for the same
 * server condition and they had already drifted: one of them explained a free daily card
 * allowance to a learner using a feature that has never had one.
 */
export function refusalMessageKey(refusal: AiRefusal): string {
  return `wallet.refusal.${refusal.kind}`
}

/**
 * What else the learner can do, if anything, for this action.
 *
 * Null for every action but grading. A screen showing this for an action with no free path
 * would be inventing an option.
 */
export function refusalFallbackKey(
  refusal: AiRefusal, actionId: PaidActionId | null | undefined,
): string | null {
  if (!isWalletRefusal(refusal) || !actionId) return null
  return PAID_ACTIONS[actionId]?.freeFallbackKey ?? null
}
