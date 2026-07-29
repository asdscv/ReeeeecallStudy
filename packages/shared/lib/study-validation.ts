import type { CrammingFilter } from './cramming-queue'
import { clampBatchSize } from './study-session-utils'
import type { StudyMode } from '../types/database'

const STUDY_MODES = [
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
