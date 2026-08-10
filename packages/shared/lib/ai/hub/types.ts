/**
 * What the AI 학습 menu knows about one of its features.
 *
 * The point of the descriptor is that adding a feature is one `.register()` call in
 * `catalog.ts` — after which it appears in the web nav submenu, the web hub page, the mobile
 * drawer sub-group, and the mobile hub screen, with no edit to any of the four. So the fields
 * are exactly what those four render or route on, and nothing else. Four members of
 * `LearningDomainAdapter` were deleted in #402 for having no reader; this list starts small on
 * purpose.
 */
import type { Identified } from '../../kernel/registry'

/** Where a feature's result actually comes from. */
export type AiHubPoweredBy =
  /** A paid model call. The hub may say "AI" about these. */
  | 'model'
  /**
   * Computed on the device — no model, no charge.
   *
   * The learning plan is this. `packages/web/src/pages/learning/LearningTodayPage.tsx` and
   * `packages/mobile/src/screens/LearningTodayScreen.tsx` both record that the paid remediation
   * was removed as a product decision; what is left is SM-2 scheduling over rows the client
   * composed. It sits in this menu because that is where a learner looks for it, but nothing
   * may badge it as AI-generated — see `AI_BADGE_ELIGIBLE` below.
   */
  | 'device'

/**
 * A key of the mobile `MainTabParamList` (`packages/mobile/src/navigation/types.ts`).
 *
 * Naming a mobile navigator from shared code is coupling, and it is the deliberate price of the
 * one-registration rule: the alternative is a per-platform id→route table, which is two edits per
 * feature and drifts the first time someone forgets one. `packages/mobile/src/screens/ai/aiHubRoutes.ts`
 * typechecks these strings against the real param list, so a rename breaks the build rather than
 * the menu.
 */
export type AiHubMobileStack = 'AITab' | 'QuizTab'

/** `extends Identified` so the descriptor states, in the type, that it is registry-storable. */
export interface AiHubEntry extends Identified {
  readonly id: string
  /** Rendered as-is. Use `{'\uXXXX'}` at the call site, never a JSX string-literal attribute. */
  readonly icon: string
  /** Ascending. `Registry.ids()` sorts alphabetically, which is not a menu order. */
  readonly order: number
  /** Key in the `ai-generate` i18n namespace, which exists on both platforms in all 8 locales. */
  readonly titleKey: string
  readonly descKey: string
  readonly webPath: string
  readonly mobileStack: AiHubMobileStack
  readonly mobileScreen: string
  readonly poweredBy: AiHubPoweredBy
}

/**
 * Whether the UI may put an "AI" badge on this entry.
 *
 * A predicate rather than a field, so the honest answer is derived from what produces the result
 * and cannot be set to `true` by hand on something that never calls a model.
 */
export function isAiBadgeEligible(entry: AiHubEntry): boolean {
  return entry.poweredBy === 'model'
}

/**
 * Where the user was when they entered the menu. Carried on every event so the funnel can tell
 * "opened the menu" from "pressed AI로 만들기 inside deck creation" — the two have very
 * different intent and only one of them is the owner's new entry point.
 */
export type AiHubSource =
  | 'nav'
  | 'hub'
  | 'dashboard'
  | 'settings'
  | 'deck_list'
  | 'deck_detail'
  | 'deck_create'
  | 'card_create'
  | 'quick_create'
  | 'template_list'
