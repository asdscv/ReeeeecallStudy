// Re-export from shared — single source of truth
export { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
export type {
  GoalKnowledge,
  LearningGoalRow, LearningGoalWithDecks, GoalDeckLink, DailyPlanRow, DailyPlanItemRow,
  LearningError, LearningErrorCode, PlanContext, CreateGoalInput, UpdateGoalInput,
  AttemptRow, AttemptInput, PlanCardRef,
  EnrichmentPreview, EnrichmentSource, EnrichmentErrorCode, RemediationAction,
  EnrichmentQuote,
} from '@reeeeecall/shared/stores/learning-store'
