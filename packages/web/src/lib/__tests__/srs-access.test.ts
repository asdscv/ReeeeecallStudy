import { describe, it, expect } from 'vitest'
import { getSrsSource, mergeCardWithProgress } from '../srs-access'

describe('getSrsSource', () => {
  it('should return "embedded" for a deck with no share_mode', () => {
    const deck = { share_mode: null, user_id: 'user-1', source_owner_id: null }
    expect(getSrsSource(deck, 'user-1')).toBe('embedded')
  })

  it('should return "embedded" for a copy deck', () => {
    const deck = { share_mode: 'copy' as const, user_id: 'user-1', source_owner_id: 'other' }
    expect(getSrsSource(deck, 'user-1')).toBe('embedded')
  })

  it('should return "embedded" for a snapshot deck', () => {
    const deck = { share_mode: 'snapshot' as const, user_id: 'user-1', source_owner_id: 'other' }
    expect(getSrsSource(deck, 'user-1')).toBe('embedded')
  })

  it('should return "progress_table" for a subscribe deck where user is not owner', () => {
    const deck = { share_mode: 'subscribe' as const, user_id: 'subscriber', source_owner_id: 'original-owner' }
    expect(getSrsSource(deck, 'subscriber')).toBe('progress_table')
  })

  it('should return "embedded" for subscribe deck where user is the original owner', () => {
    const deck = { share_mode: 'subscribe' as const, user_id: 'owner', source_owner_id: 'owner' }
    expect(getSrsSource(deck, 'owner')).toBe('embedded')
  })

  it('should return "embedded" when share_mode is subscribe but source_owner_id is null', () => {
    const deck = { share_mode: 'subscribe' as const, user_id: 'user-1', source_owner_id: null }
    expect(getSrsSource(deck, 'user-1')).toBe('embedded')
  })
})

describe('mergeCardWithProgress', () => {
  const baseCard = {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'hello', back: '안녕' },
    tags: [],
    sort_position: 0,
    srs_status: 'review' as const,
    ease_factor: 2.5,
    interval_days: 10,
    repetitions: 3,
    next_review_at: '2025-06-01T00:00:00Z',
    last_reviewed_at: '2025-05-20T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-05-20T00:00:00Z',
  }

  it('should use card SRS data when no progress is provided', () => {
    const merged = mergeCardWithProgress(baseCard)

    expect(merged.id).toBe('card-1')
    expect(merged.srs_status).toBe('review')
    expect(merged.ease_factor).toBe(2.5)
    expect(merged.interval_days).toBe(10)
    expect(merged.repetitions).toBe(3)
    expect(merged.next_review_at).toBe('2025-06-01T00:00:00Z')
    expect(merged.field_values).toEqual({ front: 'hello', back: '안녕' })
  })

  it('should override SRS data with progress when provided', () => {
    const progress = {
      id: 'progress-1',
      user_id: 'subscriber',
      card_id: 'card-1',
      deck_id: 'deck-1',
      srs_status: 'learning' as const,
      ease_factor: 2.0,
      interval_days: 1,
      repetitions: 1,
      next_review_at: '2025-05-22T00:00:00Z',
      last_reviewed_at: '2025-05-21T00:00:00Z',
      created_at: '2025-05-21T00:00:00Z',
      updated_at: '2025-05-21T00:00:00Z',
    }

    const merged = mergeCardWithProgress(baseCard, progress)

    expect(merged.id).toBe('card-1')
    expect(merged.field_values).toEqual({ front: 'hello', back: '안녕' })
    expect(merged.srs_status).toBe('learning')
    expect(merged.ease_factor).toBe(2.0)
    expect(merged.interval_days).toBe(1)
    expect(merged.repetitions).toBe(1)
    expect(merged.next_review_at).toBe('2025-05-22T00:00:00Z')
    expect(merged.last_reviewed_at).toBe('2025-05-21T00:00:00Z')
  })

  it('should use default SRS values when progress has no data', () => {
    const progress = {
      id: 'progress-2',
      user_id: 'subscriber',
      card_id: 'card-1',
      deck_id: 'deck-1',
      srs_status: 'new' as const,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      next_review_at: null,
      last_reviewed_at: null,
      created_at: '2025-05-21T00:00:00Z',
      updated_at: '2025-05-21T00:00:00Z',
    }

    const merged = mergeCardWithProgress(baseCard, progress)
    expect(merged.srs_status).toBe('new')
    expect(merged.ease_factor).toBe(2.5)
    expect(merged.interval_days).toBe(0)
    expect(merged.repetitions).toBe(0)
    expect(merged.next_review_at).toBeNull()
  })
})
