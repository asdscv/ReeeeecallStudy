// Re-export from shared — single source of truth
export { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
export type {
  LearningGoalRow, LearningGoalWithDecks, GoalDeckLink, DailyPlanRow, DailyPlanItemRow,
  LearningError, LearningErrorCode, PlanContext, CreateGoalInput, UpdateGoalInput,
} from '@reeeeecall/shared/stores/learning-store'
