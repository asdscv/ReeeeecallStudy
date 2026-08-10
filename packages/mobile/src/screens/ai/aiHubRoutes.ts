import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import type { AiHubMobileStack } from '@reeeeecall/shared/lib/ai/hub/types'
import type { AIStackParamList, MainTabParamList, QuizStackParamList } from '../../navigation/types'

/**
 * The mobile half of the shared descriptor's routing bargain.
 *
 * `AiHubEntry.mobileStack` / `.mobileScreen` are plain strings in `packages/shared/lib/ai/hub/types.ts`
 * so that registering a feature stays one call — shared code cannot import a mobile param list.
 * The cost is that a renamed screen would compile fine and break the menu at runtime. This file
 * pays it back: the table below is pinned to the real param lists, so a rename fails the build,
 * and `aiHubRouteIssues()` catches the other direction (a catalog entry pointing nowhere).
 */

/** Which param list each stack the catalog may name actually addresses. */
interface AiHubStackParamLists {
  AITab: AIStackParamList
  QuizTab: QuizStackParamList
}

/** Compile error if the catalog ever names a stack that is not a drawer route. */
export type AiHubStacksAreDrawerRoutes = AiHubMobileStack extends keyof MainTabParamList ? true : never

type AiHubStackScreens = {
  readonly [S in AiHubMobileStack]: readonly (keyof AiHubStackParamLists[S] & string)[]
}

export const AI_HUB_STACK_SCREENS = {
  AITab: ['AIHub', 'AIGenerate', 'LearningGoals', 'LearningToday'],
  QuizTab: ['QuizHome', 'QuizSetup', 'QuizRun', 'QuizResult'],
} satisfies AiHubStackScreens

/**
 * Entries whose route does not exist. Empty in a healthy build — a test can assert that, and
 * `AIStack` warns in development so a drifted catalog is visible before it reaches a store.
 */
export function aiHubRouteIssues(): readonly string[] {
  const screens: Record<AiHubMobileStack, readonly string[]> = AI_HUB_STACK_SCREENS
  return aiHubEntries()
    .filter((entry) => !screens[entry.mobileStack].includes(entry.mobileScreen))
    .map((entry) => `${entry.id} -> ${entry.mobileStack}/${entry.mobileScreen}`)
}
