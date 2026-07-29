/**
 * Repository port contracts for the learning engine.
 *
 * Design §6.2: Ports return domain values and typed errors. They do not leak
 * Supabase response shapes. Infrastructure adapters implement these.
 * No framework/Supabase/Zustand imports.
 */

import type { Result } from '../domain/result.ts'
import type { LearningError } from '../domain/errors.ts'
import type {
  LearningGoal,
  LearningConcept,
  LearningActivity,
  ContentSource,
  AnswerAttempt,
  DailyPlan,
  DailyPlanItem,
  StudyRecommendation,
  UserEnrichment,
  GoalStatus,
  EnrichmentStatus,
  RecommendationStatus,
  PlannerCandidate,
} from '../domain/types.ts'

// ─── LearningGoalRepository ─────────────────────────────────────────────────

export interface CreateGoalInput {
  readonly userId: string
  readonly domainId: string
  readonly title: string
  readonly targetDate: string | null
  readonly dailyMinutes: number
  readonly target: Record<string, unknown>
  readonly settings: Record<string, unknown>
}

export interface UpdateGoalInput {
  readonly id: string
  readonly title?: string
  readonly targetDate?: string | null
  readonly dailyMinutes?: number
  readonly status?: GoalStatus
  readonly target?: Record<string, unknown>
  readonly settings?: Record<string, unknown>
}

export interface LearningGoalRepository {
  findById(id: string, userId: string): Promise<Result<LearningGoal>>
  findByUser(userId: string, statuses?: GoalStatus[]): Promise<Result<readonly LearningGoal[]>>
  create(input: CreateGoalInput): Promise<Result<LearningGoal>>
  update(input: UpdateGoalInput, userId: string): Promise<Result<LearningGoal>>
  archive(id: string, userId: string): Promise<Result<void>>
}

// ─── LearningContentRepository ──────────────────────────────────────────────

export interface LearningContentRepository {
  findConceptById(id: string): Promise<Result<LearningConcept>>
  findConceptsByDomain(domainId: string, ownerUserId: string | null): Promise<Result<readonly LearningConcept[]>>
  findActivityById(id: string): Promise<Result<LearningActivity>>
  findActivitiesByConcept(conceptId: string): Promise<Result<readonly LearningActivity[]>>
  findActivitiesByCard(cardId: string): Promise<Result<readonly LearningActivity[]>>
  findSourceById(id: string): Promise<Result<ContentSource>>
}

// ─── LearningHistoryRepository ──────────────────────────────────────────────

export interface RecentAttemptQuery {
  readonly userId: string
  readonly activityId?: string
  readonly cardId?: string
  readonly conceptId?: string
  readonly limit?: number
  readonly since?: string
}

export interface LearningHistoryRepository {
  findRecentAttempts(query: RecentAttemptQuery): Promise<Result<readonly AnswerAttempt[]>>
  countAttemptsByDay(userId: string, date: string): Promise<Result<number>>
}

// ─── DailyPlanRepository ────────────────────────────────────────────────────

export interface SavePlanInput {
  readonly userId: string
  readonly goalId: string
  readonly planDate: string
  readonly timezone: string
  readonly algorithmVersion: string
  readonly inputFingerprint: string
  readonly budgetMinutes: number
  readonly items: readonly SavePlanItemInput[]
}

export interface SavePlanItemInput {
  readonly position: number
  readonly activityId: string | null
  readonly cardId: string | null
  readonly conceptId: string | null
  readonly activityType: string
  readonly stimulusType: string
  readonly responseType: string
  readonly evaluatorType: string
  readonly reasonCode: string
  readonly priority: number
  readonly estimatedMinutes: number
  readonly payload: Record<string, unknown>
}

export interface DailyPlanRepository {
  findByDateAndGoal(userId: string, goalId: string, planDate: string): Promise<Result<DailyPlan | null>>
  findItemsByPlan(planId: string): Promise<Result<readonly DailyPlanItem[]>>
  save(input: SavePlanInput): Promise<Result<DailyPlan>>
  completePlanItem(planItemId: string, attemptId: string, userId: string): Promise<Result<void>>
  countPlanSavesByDay(userId: string, date: string): Promise<Result<number>>
}

// ─── AnswerAttemptRepository ────────────────────────────────────────────────

export interface RecordAttemptInput {
  readonly userId: string
  readonly goalId: string | null
  readonly activityId: string | null
  readonly cardId: string | null
  readonly planItemId: string | null
  readonly clientAttemptId: string
  readonly activityType: string
  readonly responseType: string
  readonly evaluatorType: string
  readonly response: Record<string, unknown>
  readonly normalizedScore: number | null
  readonly evaluatorResult: Record<string, unknown> | null
  readonly feedback: Record<string, unknown> | null
  readonly hintsUsed: number
  readonly durationMs: number
  readonly evaluatorVersion: string
}

export interface AnswerAttemptRepository {
  record(input: RecordAttemptInput): Promise<Result<AnswerAttempt>>
  findById(id: string, userId: string): Promise<Result<AnswerAttempt>>
}

// ─── RecommendationRepository ───────────────────────────────────────────────

export interface RecommendationRepository {
  findByUser(userId: string, status?: RecommendationStatus): Promise<Result<readonly StudyRecommendation[]>>
  updateStatus(id: string, userId: string, status: RecommendationStatus): Promise<Result<void>>
}

// ─── EnrichmentRepository ───────────────────────────────────────────────────

export interface CreateEnrichmentInput {
  readonly userId: string
  readonly goalId: string | null
  readonly conceptId: string | null
  readonly cardId: string | null
  readonly activityId: string | null
  readonly action: string
  readonly requestFingerprint: string | null
  readonly content: Record<string, unknown>
  readonly sourceRefs: readonly string[]
  readonly modelVersion: string | null
  readonly provider: string | null
  readonly promptVersion: string | null
}

export interface EnrichmentRepository {
  create(input: CreateEnrichmentInput): Promise<Result<UserEnrichment>>
  findByUser(userId: string, status?: EnrichmentStatus): Promise<Result<readonly UserEnrichment[]>>
  updateStatus(id: string, userId: string, status: EnrichmentStatus): Promise<Result<void>>
}

// ─── PlannerCandidateRepository ─────────────────────────────────────────────

/**
 * Provides normalized planner candidates. This combines data from multiple
 * sources (activities, cards, attempts, progress) into the format the planner needs.
 */
export interface PlannerCandidateRepository {
  getCandidates(
    userId: string,
    goalId: string,
    now: string,
    timezone: string,
  ): Promise<Result<readonly PlannerCandidate[], LearningError>>
}
