/**
 * The AI 학습 menu, as data.
 *
 * This file is the whole extension point: a new AI feature is one `.register()` below, and it
 * then appears in the web nav submenu (`packages/web/src/components/common/Layout.tsx`), the web
 * hub page (`packages/web/src/pages/ai/AIHubPage.tsx`), the mobile drawer sub-group
 * (`packages/mobile/src/navigation/MainDrawer.tsx`) and the mobile hub screen
 * (`packages/mobile/src/screens/ai/AIHubScreen.tsx`) — none of which name a feature.
 *
 * Composition root shape copied from `packages/shared/learning/adapters/domain-catalog.ts`:
 * a `createDefault…` factory (so tests get a clean instance), a module-level singleton, and free
 * functions that read it.
 */
import { Registry } from '../../kernel/registry'
import type { AiHubEntry } from './types'

export const AI_HUB_LEARNING_PLAN = 'learning_plan'
export const AI_HUB_QUIZ = 'quiz'
export const AI_HUB_GENERATE = 'generate'

export function createDefaultAiHubRegistry(): Registry<AiHubEntry> {
  return new Registry<AiHubEntry>('AiHubRegistry')
    .register({
      id: AI_HUB_LEARNING_PLAN,
      icon: 'target',
      order: 10,
      titleKey: 'hub.entries.learningPlan.title',
      descKey: 'hub.entries.learningPlan.desc',
      webPath: '/learning',
      mobileStack: 'AITab',
      mobileScreen: 'LearningGoals',
      // Not a model call — see the `AiHubPoweredBy` docblock before changing this.
      poweredBy: 'device',
      spends: null,
    })
    .register({
      id: AI_HUB_QUIZ,
      icon: 'help-circle',
      order: 20,
      titleKey: 'hub.entries.quiz.title',
      descKey: 'hub.entries.quiz.desc',
      webPath: '/quiz',
      // Quiz keeps its own stack: taking a quiz disables the back gesture and owns the screen,
      // which is why `QuizStack` exists separately from every other flow.
      mobileStack: 'QuizTab',
      mobileScreen: 'QuizHome',
      poweredBy: 'model',
      // Questions, not cards. Since mig 239 the quiz allowance is counted per QUESTION whatever
      // its type, on its own daily limit.
      spends: 'quiz_generate',
    })
    .register({
      id: AI_HUB_GENERATE,
      icon: 'cpu',
      order: 30,
      titleKey: 'hub.entries.generate.title',
      descKey: 'hub.entries.generate.desc',
      webPath: '/ai-generate',
      mobileStack: 'AITab',
      mobileScreen: 'AIGenerate',
      poweredBy: 'model',
      spends: 'card',
    })
}

const DEFAULT_REGISTRY = createDefaultAiHubRegistry()

/** Menu order — by `order`, then id, so two entries sharing an order stay deterministic. */
export function aiHubEntries(): readonly AiHubEntry[] {
  return [...DEFAULT_REGISTRY.all()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** `null` for an unknown id, so a stale deep link or persisted id degrades instead of throwing. */
export function aiHubEntryFor(id: string): AiHubEntry | null {
  return DEFAULT_REGISTRY.find(id)
}
