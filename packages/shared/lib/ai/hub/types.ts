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
 * Which daily free allowance this feature draws on.
 *
 * The same names as `ai_free_allowances.action_group` (mig 239), because that table is the
 * authority and a second vocabulary would drift from it. `null` for a feature that spends
 * nothing — the learning plan.
 *
 * It exists because the credit notice was reporting the CARD allowance on every AI surface,
 * quiz screens included: a learner setting up a quiz read "오늘 남은 무료 카드 10장" above the
 * form and "오늘 무료 문항 3/5개 남음" below it. Two numbers, two different features, and the
 * bigger and more prominent one was about the other one.
 */
export type AiHubSpends = 'card' | 'quiz_generate' | null

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
  /**
   * 아이콘의 **의미 이름**이다. 이모지가 아니다.
   *
   * 예전에는 '🎯' 같은 이모지를 그대로 넣었는데, 이모지는 플랫폼·폰트마다 다르게
   * 그려지고 색을 못 따라간다(활성 상태를 표현할 수 없다). 여기에는 이름만 두고
   * 웹은 lucide, 모바일은 @expo/vector-icons 의 Feather 로 각자 그린다 —
   * 두 세트가 공통으로 갖는 이름만 쓴다(target · help-circle · cpu).
   */
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
  /**
   * The daily allowance this feature draws on, or `null` when it spends nothing.
   *
   * Not derived from `poweredBy`: two features can both call a model and draw on different
   * allowances, which is exactly the case this field exists for.
   */
  readonly spends: AiHubSpends
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
