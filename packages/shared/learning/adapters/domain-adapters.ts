import { unsupportedCapabilityError } from '../domain/errors.ts'
import type {
  GoalRelevanceContext, LearningActivity, LearningDomainAdapter, LearningGoal,
  NormalizedScore, RubricCriterion,
} from '../domain/types.ts'
import type { Card } from '../../types/database.ts'

export interface LegacyCardActivityInput {
  readonly card: Card
  readonly persistedActivities: readonly LearningActivity[]
  readonly frontFieldKeys?: readonly string[]
  readonly backFieldKeys?: readonly string[]
  readonly title?: string
}

function pickFields(values: Record<string, string>, keys: readonly string[] | undefined, fallbackIndex: number): Record<string, string> {
  const available = Object.keys(values)
  const selected = keys?.length ? keys : available[fallbackIndex] ? [available[fallbackIndex]] : available.slice(0, 1)
  return Object.fromEntries(selected.filter((key) => key in values).map((key) => [key, values[key]]))
}

/** Compatibility projection only. It never persists or mutates an official/legacy card. */
export function activitiesForLegacyCard(input: LegacyCardActivityInput): readonly LearningActivity[] {
  const persistedRecall = input.persistedActivities.filter((activity) => activity.cardId === input.card.id && activity.activityType === 'recall')
  if (persistedRecall.length > 0) return persistedRecall

  const front = pickFields(input.card.field_values, input.frontFieldKeys, 0)
  const back = pickFields(input.card.field_values, input.backFieldKeys, 1)
  return [{
    id: `legacy-card:${input.card.id}:recall`,
    ownerUserId: input.card.user_id,
    conceptId: null,
    cardId: input.card.id,
    sourceId: null,
    activityType: 'recall',
    stimulusType: 'text',
    responseType: 'self_rate',
    evaluatorType: 'self_rate',
    title: input.title ?? 'Card recall',
    instructions: null,
    stimulus: { fields: front },
    expectedResponse: { fields: Object.keys(back).length ? back : front },
    rubric: null,
    config: { compatibility: 'legacy-card-v1', transient: true },
    difficulty: null,
    contentVersion: 1,
    createdAt: input.card.created_at,
    updatedAt: input.card.updated_at,
  }]
}

export function assertImplementedMedia(activity: Pick<LearningActivity, 'stimulusType' | 'responseType' | 'evaluatorType'>): void {
  if (activity.stimulusType === 'audio' || activity.responseType === 'audio' || activity.evaluatorType === 'speech') {
    throw unsupportedCapabilityError('speech/audio activity', `${activity.stimulusType}/${activity.responseType}/${activity.evaluatorType}`)
  }
}

export const languageDomainAdapter: LearningDomainAdapter = {
  id: 'language',
  version: 'language-v1',
  supportedActivityTypes: ['recall', 'practice', 'produce'],
  defaultPlanMix: { recall: 0.6, practice: 0.25, produce: 0.15 },
  validateActivity(activity) {
    const errors: string[] = []
    try { assertImplementedMedia(activity) } catch (error) { errors.push(error instanceof Error ? error.message : 'Unsupported media') }
    if (!this.supportedActivityTypes.includes(activity.activityType)) errors.push(`Unsupported language activity: ${activity.activityType}`)
    if (activity.stimulusType === 'text' && (!activity.stimulus || Object.keys(activity.stimulus).length === 0)) errors.push('Text stimulus is required')
    return { valid: errors.length === 0, errors }
  },
  scoreGoalRelevance(context) {
    if (context.goal.domainId !== 'language') return 0
    const preferred = context.goal.settings.preferredActivityTypes
    return Array.isArray(preferred) && preferred.includes(context.activityType) ? 1 : 0.75
  },
  promptPolicy: { requireSourceGrounding: false, educationalWarning: null, maxPromptTokens: 4000 },
}

export const LABOR_LAW_ISSUE_RULE_APPLICATION_CONCLUSION_RUBRIC: Readonly<{ criteria: readonly RubricCriterion[] }> = Object.freeze({
  criteria: Object.freeze([
    { id: 'issue', label: 'Issue spotting', weight: 0.2, maxScore: 4 },
    { id: 'rule', label: 'Applicable rule and source', weight: 0.3, maxScore: 4, requiredEvidence: 'Cite the supplied statute or precedent.' },
    { id: 'application', label: 'Reasoned application', weight: 0.4, maxScore: 4 },
    { id: 'conclusion', label: 'Qualified conclusion', weight: 0.1, maxScore: 4 },
  ]),
})

export const laborLawDomainAdapter: LearningDomainAdapter = {
  id: 'labor-law',
  version: 'labor-law-v1',
  supportedActivityTypes: ['recall', 'practice', 'produce'],
  defaultPlanMix: { recall: 0.35, practice: 0.35, produce: 0.3 },
  validateActivity(activity) {
    const errors: string[] = []
    try { assertImplementedMedia(activity) } catch (error) { errors.push(error instanceof Error ? error.message : 'Unsupported media') }
    if (!this.supportedActivityTypes.includes(activity.activityType)) errors.push(`Unsupported labor-law activity: ${activity.activityType}`)
    if (activity.activityType === 'produce' && activity.evaluatorType !== 'rubric' && activity.evaluatorType !== 'ai') errors.push('Labor-law production requires rubric or AI evaluation')
    if (!activity.sourceId) errors.push('Labor-law activities require a source')
    return { valid: errors.length === 0, errors }
  },
  scoreGoalRelevance(context: GoalRelevanceContext) {
    if (context.goal.domainId !== 'labor-law') return 0
    const target = context.goal.target as { examDate?: unknown; emphasis?: unknown }
    const productionBoost = context.activityType === 'produce' ? 0.15 : 0
    const examBoost = typeof target.examDate === 'string' ? 0.1 : 0
    return Math.min(1, 0.7 + productionBoost + examBoost)
  },
  contentValidators: [{
    id: 'labor-law-source-v1',
    validate(content) {
      const refs = content.sourceRefs
      const valid = Array.isArray(refs) && refs.length > 0 && refs.every((value) => typeof value === 'string')
      return { valid, errors: valid ? [] : ['At least one source reference is required'] }
    },
  }],
  promptPolicy: {
    requireSourceGrounding: true,
    educationalWarning: 'Educational exam preparation only; not legal advice.',
    maxPromptTokens: 6000,
  },
}

export function createLaborLawExampleGoal(userId: string, now: string): LearningGoal {
  return {
    id: 'example-labor-law-goal', userId, domainId: 'labor-law', title: 'Certified labor-attorney written exam',
    targetDate: null, dailyMinutes: 30, status: 'active', target: { qualification: 'certified-labor-attorney' },
    settings: { preferredActivityTypes: ['practice', 'produce'] }, createdAt: now, updatedAt: now,
  }
}

export function asNormalizedScore(value: number): NormalizedScore {
  return Math.max(0, Math.min(1, value)) as NormalizedScore
}
