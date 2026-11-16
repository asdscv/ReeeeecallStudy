// Re-export from shared — single source of truth
export { useLearningStore } from '@reklue/shared/stores/learning-store'
export type {
  GoalKnowledge,
  LearningGoalRow, LearningGoalWithDecks, GoalDeckLink, DailyPlanRow, DailyPlanItemRow,
  LearningError, LearningErrorCode, PlanContext, CreateGoalInput, UpdateGoalInput,
  AttemptRow, AttemptInput, PlanCardRef,
} from '@reklue/shared/stores/learning-store'
