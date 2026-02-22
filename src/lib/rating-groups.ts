import type { StudyMode } from '../types/database'

// ── Types ──

export type RatingGroupId = 'srs' | 'simple' | 'cramming'

export interface RatingGroupDef {
  id: RatingGroupId
  ratings: string[]
  modes: StudyMode[]
  colors: Record<string, string>
  i18nKey: string
}

// ── Registry (single source of truth) ──

export const RATING_GROUP_REGISTRY: RatingGroupDef[] = [
  {
    id: 'srs',
    ratings: ['again', 'hard', 'good', 'easy'],
    modes: ['srs'],
    colors: {
      again: '#ef4444',
      hard: '#f97316',
      good: '#22c55e',
      easy: '#3b82f6',
    },
    i18nKey: 'ratingGroups.srs',
  },
  {
    id: 'simple',
    ratings: ['unknown', 'known'],
    modes: ['random', 'sequential', 'by_date', 'sequential_review'],
    colors: {
      unknown: '#ef4444',
      known: '#22c55e',
    },
    i18nKey: 'ratingGroups.simple',
  },
  {
    id: 'cramming',
    ratings: ['missed', 'got_it'],
    modes: ['cramming'],
    colors: {
      missed: '#ef4444',
      got_it: '#22c55e',
    },
    i18nKey: 'ratingGroups.cramming',
  },
]

// ── Derived maps ──

/** Ratings that should be excluded from distribution charts (not real ratings). */
export const EXCLUDED_RATINGS = new Set(['next'])

/** Map from StudyMode → RatingGroupId. */
export const STUDY_MODE_TO_GROUP: Record<StudyMode, RatingGroupId> = Object.fromEntries(
  RATING_GROUP_REGISTRY.flatMap((g) => g.modes.map((m) => [m, g.id]))
) as Record<StudyMode, RatingGroupId>

/** Flat color map for all ratings across all groups. */
export const RATING_COLOR_MAP: Record<string, string> = Object.fromEntries(
  RATING_GROUP_REGISTRY.flatMap((g) => Object.entries(g.colors))
)
