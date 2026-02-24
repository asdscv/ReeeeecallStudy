import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => opts?.count !== undefined ? `${key}:${opts.count}` : key },
}))

import { calculateSRS, previewIntervals, type SrsCardData } from '../srs'
import type { Card, SrsSettings } from '../../types/database'

/**
 * Tests that SrsCardData interface works with calculateSRS
 * and that existing Card type still works (backward compatibility).
 */

// Use no-steps settings to test pure review logic (backward compat)
const NO_STEPS: SrsSettings = { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4, learning_steps: [] }

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'hello', back: '안녕' },
    tags: [],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSrsData(overrides?: Partial<SrsCardData>): SrsCardData {
  return {
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    ...overrides,
  }
}

describe('SrsCardData backward compatibility', () => {
  it('should accept SrsCardData (minimal interface) in calculateSRS', () => {
    const data = makeSrsData()
    const result = calculateSRS(data, 'good', NO_STEPS)

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(1)
    expect(result.ease_factor).toBe(2.5)
  })

  it('should accept full Card object in calculateSRS (unchanged behavior)', () => {
    const card = makeCard()
    const result = calculateSRS(card, 'good', NO_STEPS)

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(1)
  })

  it('should produce same result for Card and matching SrsCardData', () => {
    const card = makeCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 10 })
    const data = makeSrsData({ ease_factor: 2.5, repetitions: 2, interval_days: 10, srs_status: 'review' })

    const cardResult = calculateSRS(card, 'good', NO_STEPS)
    const dataResult = calculateSRS(data, 'good', NO_STEPS)

    expect(cardResult.ease_factor).toBe(dataResult.ease_factor)
    expect(cardResult.interval_days).toBe(dataResult.interval_days)
    expect(cardResult.repetitions).toBe(dataResult.repetitions)
  })

  it('should accept SrsCardData with progress_table data (subscribe user)', () => {
    const progressData = makeSrsData({
      srs_status: 'learning',
      ease_factor: 2.0,
      interval_days: 1,
      repetitions: 1,
    })
    // With default learning_steps [1, 10], a learning card at step 1 + good → graduates
    const result = calculateSRS(progressData, 'good')

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(1) // good_days
    expect(result.repetitions).toBe(1)
  })

  it('previewIntervals should work with SrsCardData (no steps)', () => {
    const data = makeSrsData()
    const preview = previewIntervals(data, NO_STEPS)

    expect(preview.again).toBe('study:interval.lessThanTenMin')
    expect(preview.hard).toBe('study:interval.oneDay')
    expect(preview.good).toBe('study:interval.oneDay')
    expect(preview.easy).toBe('study:interval.days:4')
  })

  it('previewIntervals should work with SrsCardData (with learning steps)', () => {
    const data = makeSrsData()
    const preview = previewIntervals(data) // uses default learning_steps [1, 10]

    // New card with steps: again → 1min, hard → 1min, good → 10min, easy → 4d
    expect(preview.again).toBe('study:interval.minutes:1')
    expect(preview.hard).toBe('study:interval.minutes:1')
    expect(preview.good).toBe('study:interval.minutes:10')
    expect(preview.easy).toBe('study:interval.days:4')
  })
})
