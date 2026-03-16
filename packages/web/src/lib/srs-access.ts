import type { SrsStatus } from '../types/database'

export type SrsSource = 'embedded' | 'progress_table'

export interface SrsDeckMeta {
  share_mode: string | null
  user_id: string
  source_owner_id: string | null
}

export interface UserCardProgress {
  id: string
  user_id: string
  card_id: string
  deck_id: string
  srs_status: SrsStatus
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  last_reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface CardWithProgress {
  id: string
  deck_id: string
  user_id: string
  template_id: string
  field_values: Record<string, string>
  tags: string[]
  sort_position: number
  srs_status: SrsStatus
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  last_reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface CardData {
  id: string
  deck_id: string
  user_id: string
  template_id: string
  field_values: Record<string, string>
  tags: string[]
  sort_position: number
  srs_status: SrsStatus
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  last_reviewed_at: string | null
  created_at: string
  updated_at: string
}

export function getSrsSource(deck: SrsDeckMeta, currentUserId: string): SrsSource {
  if (
    deck.share_mode === 'subscribe' &&
    deck.source_owner_id !== null &&
    deck.source_owner_id !== currentUserId
  ) {
    return 'progress_table'
  }
  return 'embedded'
}

export function mergeCardWithProgress(
  card: CardData,
  progress?: UserCardProgress,
): CardWithProgress {
  if (!progress) {
    return { ...card }
  }

  return {
    ...card,
    srs_status: progress.srs_status,
    ease_factor: progress.ease_factor,
    interval_days: progress.interval_days,
    repetitions: progress.repetitions,
    next_review_at: progress.next_review_at,
    last_reviewed_at: progress.last_reviewed_at,
  }
}
