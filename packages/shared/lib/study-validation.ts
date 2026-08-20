import type { CrammingFilter } from './cramming-queue'
import { clampBatchSize } from './study-session-utils'
import type { StudyMode } from '../types/database'

// 랜딩이 "6가지 학습 모드"를 이 배열에서 셉니다 — 문구가 코드보다 뒤처지지 않도록.
export const STUDY_MODES = [
  'srs',
  'sequential_review',
  'random',
  'sequential',
  'by_date',
  'cramming',
] as const satisfies readonly StudyMode[]

const SRS_RATINGS = new Set(['again', 'hard', 'good', 'easy'])
const SIMPLE_RATINGS = new Set(['known', 'unknown', 'next', 'viewed'])

export type NormalizedStudyRating =
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  | 'got_it'
  | 'missed'
  | 'known'
  | 'unknown'
  | 'next'
  | 'viewed'

export interface StudyConfigInput {
  deckId: unknown
  mode: unknown
  batchSize: unknown
  uploadDateStart?: unknown
  uploadDateEnd?: unknown
  crammingFilter?: unknown
  crammingTimeLimitMinutes?: unknown
  crammingShuffle?: unknown
  planSelection?: unknown
  cardSelection?: unknown
}

/**
 * One deck's share of a daily plan, when the session IS the plan.
 *
 * Structurally validated like everything else here rather than passed through: the item fields
 * are asserted against the stored plan-item snapshot by `record_answer_attempt`, which raises
 * P0007 on any mismatch, so a malformed one would surface as an unexplained rating failure
 * mid-session rather than as a refusal to start.
 */
export interface NormalizedPlanSelection {
  goalId: string
  cardIds: string[]
  items: Record<string, {
    id: string
    activity_type: string
    response_type: string
    evaluator_type: string
  }>
}

export interface NormalizedStudyConfig {
  deckId: string
  mode: StudyMode
  batchSize: number
  uploadDateStart?: string
  uploadDateEnd?: string
  crammingFilter?: CrammingFilter
  crammingTimeLimitMinutes?: number | null
  crammingShuffle?: boolean
  planSelection?: NormalizedPlanSelection
  /**
   * Study exactly these cards, in this order, and nothing else.
   *
   * The diagnostics panel's "다시 볼 카드" button: cards the learner keeps failing, which are
   * usually NOT due, so the ordinary SRS queue would refuse to serve them. Distinct from
   * `planSelection` — it completes no plan item, because these cards were not on the plan.
   */
  cardSelection?: string[]
}

export class StudyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudyValidationError'
  }
}

export function isStudyMode(value: unknown): value is StudyMode {
  return typeof value === 'string' && (STUDY_MODES as readonly string[]).includes(value)
}

function normalizeDateRange(start: unknown, end: unknown): { start: string; end: string } {
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new StudyValidationError('A valid date range is required for by_date mode')
  }
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new StudyValidationError('A valid ordered date range is required for by_date mode')
  }
  return { start, end }
}

function normalizeCrammingFilter(raw: unknown): CrammingFilter {
  if (raw == null) return { type: 'all' }
  if (typeof raw !== 'object') {
    throw new StudyValidationError('Invalid cramming filter')
  }

  const filter = raw as Record<string, unknown>
  switch (filter.type) {
    case 'all':
      return { type: 'all' }
    case 'weak': {
      const maxEaseFactor = filter.maxEaseFactor
      if (typeof maxEaseFactor !== 'number' || !Number.isFinite(maxEaseFactor) || maxEaseFactor <= 0) {
        throw new StudyValidationError('Invalid weak cramming filter')
      }
      return { type: 'weak', maxEaseFactor }
    }
    case 'due_soon': {
      const withinDays = filter.withinDays
      if (typeof withinDays !== 'number' || !Number.isFinite(withinDays) || withinDays < 0) {
        throw new StudyValidationError('Invalid due-soon cramming filter')
      }
      return { type: 'due_soon', withinDays: Math.round(withinDays) }
    }
    case 'tags': {
      if (!Array.isArray(filter.tags)) {
        throw new StudyValidationError('Invalid tags cramming filter')
      }
      const tags = [...new Set(filter.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.trim())
        .filter(Boolean))]
      if (tags.length === 0) {
        throw new StudyValidationError('Invalid tags cramming filter')
      }
      return { type: 'tags', tags }
    }
    default:
      throw new StudyValidationError('Invalid cramming filter')
  }
}

/**
 * A bare list of card ids, deduplicated, order preserved.
 *
 * Order is the caller's ranking (worst-scoring card first), so it is kept rather than sorted.
 * Duplicates are dropped rather than rejected: two rows naming the same card is a caller bug
 * that should not cost the learner a session, and studying a card twice in one queue would
 * ask them to rate a card whose schedule the first rating already moved.
 */
function normalizeCardSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new StudyValidationError('cardSelection must be an array')
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new StudyValidationError('cardSelection must hold non-empty card ids')
    }
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  if (out.length === 0) throw new StudyValidationError('cardSelection cannot be empty')
  return out
}

function normalizePlanSelection(raw: unknown): NormalizedPlanSelection {
  if (raw == null || typeof raw !== 'object') {
    throw new StudyValidationError('Invalid plan selection')
  }
  const input = raw as Record<string, unknown>
  if (typeof input.goalId !== 'string' || input.goalId.trim().length === 0) {
    throw new StudyValidationError('Invalid plan selection goal')
  }
  if (!Array.isArray(input.cardIds) || input.cardIds.length === 0) {
    throw new StudyValidationError('A plan selection needs at least one card')
  }
  const items = input.items
  if (items == null || typeof items !== 'object') {
    throw new StudyValidationError('Invalid plan selection items')
  }

  const cardIds: string[] = []
  const normalizedItems: NormalizedPlanSelection['items'] = {}
  for (const cardId of input.cardIds) {
    if (typeof cardId !== 'string' || cardId.trim().length === 0) {
      throw new StudyValidationError('Invalid plan selection card id')
    }
    const item = (items as Record<string, unknown>)[cardId]
    if (item == null || typeof item !== 'object') {
      throw new StudyValidationError(`Plan selection has no item for card ${cardId}`)
    }
    const row = item as Record<string, unknown>
    for (const key of ['id', 'activity_type', 'response_type', 'evaluator_type'] as const) {
      if (typeof row[key] !== 'string' || (row[key] as string).length === 0) {
        throw new StudyValidationError(`Plan item is missing ${key}`)
      }
    }
    // Deduped, because the queue is built by looking each id up once: a repeat would put the
    // same card in the session twice and the second rating would be refused as a re-completion.
    if (cardId in normalizedItems) continue
    cardIds.push(cardId)
    normalizedItems[cardId] = {
      id: row.id as string,
      activity_type: row.activity_type as string,
      response_type: row.response_type as string,
      evaluator_type: row.evaluator_type as string,
    }
  }

  return { goalId: input.goalId.trim(), cardIds, items: normalizedItems }
}

export function normalizeStudyConfig(input: StudyConfigInput): NormalizedStudyConfig {
  if (typeof input.deckId !== 'string' || input.deckId.trim().length === 0) {
    throw new StudyValidationError('Invalid deckId')
  }
  if (!isStudyMode(input.mode)) {
    throw new StudyValidationError('Invalid study mode')
  }
  if (typeof input.batchSize !== 'number' || !Number.isFinite(input.batchSize)) {
    throw new StudyValidationError('Invalid batch size')
  }

  const normalized: NormalizedStudyConfig = {
    deckId: input.deckId.trim(),
    mode: input.mode,
    batchSize: clampBatchSize(input.batchSize),
  }

  if (input.mode === 'by_date') {
    const range = normalizeDateRange(input.uploadDateStart, input.uploadDateEnd)
    normalized.uploadDateStart = range.start
    normalized.uploadDateEnd = range.end
  }

  if (input.mode === 'cramming') {
    normalized.crammingFilter = normalizeCrammingFilter(input.crammingFilter)

    const timeLimit = input.crammingTimeLimitMinutes
    if (timeLimit == null) {
      normalized.crammingTimeLimitMinutes = null
    } else if (typeof timeLimit === 'number' && Number.isFinite(timeLimit) && timeLimit >= 0) {
      normalized.crammingTimeLimitMinutes = timeLimit
    } else {
      throw new StudyValidationError('Invalid cramming time limit')
    }

    if (input.crammingShuffle != null && typeof input.crammingShuffle !== 'boolean') {
      throw new StudyValidationError('Invalid cramming shuffle option')
    }
    normalized.crammingShuffle = input.crammingShuffle ?? false
  }

  // SRS only. The other five modes send no SRS payload and reschedule nothing
  // (`modeFeedsSrsSchedule`), so a plan session in one of them would complete the day's items
  // while leaving every input the planner reads untouched — tomorrow's plan would come back
  // identical. The server refuses it too; refusing here means the session never starts rather
  // than failing on the first rating.
  if (input.planSelection != null) {
    if (input.mode !== 'srs') {
      throw new StudyValidationError('A plan session must be SRS mode')
    }
    normalized.planSelection = normalizePlanSelection(input.planSelection)
  }

  // Same SRS-only rule, same reason: a cramming session moves no schedule, so re-studying a
  // card the learner keeps failing in one of those modes would change nothing about when it
  // comes back. The whole point of the button is to move those cards.
  if (input.cardSelection != null) {
    if (input.mode !== 'srs') {
      throw new StudyValidationError('A card-selection session must be SRS mode')
    }
    if (normalized.planSelection) {
      // Both would name a queue and only one can win. Silently picking is how a learner ends
      // up studying something other than what they pressed.
      throw new StudyValidationError('planSelection and cardSelection are mutually exclusive')
    }
    normalized.cardSelection = normalizeCardSelection(input.cardSelection)
  }

  return normalized
}

export function normalizeRatingForMode(
  mode: StudyMode,
  rating: unknown,
): NormalizedStudyRating | null {
  if (typeof rating !== 'string') return null

  if (mode === 'srs') {
    return SRS_RATINGS.has(rating) ? rating as NormalizedStudyRating : null
  }

  if (mode === 'cramming') {
    if (rating === 'known') return 'got_it'
    if (rating === 'unknown') return 'missed'
    return rating === 'got_it' || rating === 'missed' ? rating : null
  }

  return SIMPLE_RATINGS.has(rating) ? rating as NormalizedStudyRating : null
}
