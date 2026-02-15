import { describe, it, expect } from 'vitest'
import { calculateSRS, previewIntervals, type SrsCardData } from '../srs'
import type { Card } from '../../types/database'

/**
 * Tests that SrsCardData interface works with calculateSRS
 * and that existing Card type still works (backward compatibility).
 */

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
    const result = calculateSRS(data, 'good')

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(1)
    expect(result.ease_factor).toBe(2.5)
  })

  it('should accept full Card object in calculateSRS (unchanged behavior)', () => {
    const card = makeCard()
    const result = calculateSRS(card, 'good')

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(1)
  })

  it('should produce same result for Card and matching SrsCardData', () => {
    const card = makeCard({ ease_factor: 2.5, repetitions: 2, interval_days: 10 })
    const data = makeSrsData({ ease_factor: 2.5, repetitions: 2, interval_days: 10, srs_status: 'review' })

    const cardResult = calculateSRS(card, 'good')
    const dataResult = calculateSRS(data, 'good')

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
    const result = calculateSRS(progressData, 'good')

    expect(result.srs_status).toBe('review')
    expect(result.interval_days).toBe(3)
    expect(result.repetitions).toBe(2)
  })

  it('previewIntervals should work with SrsCardData', () => {
    const data = makeSrsData()
    const preview = previewIntervals(data)

    expect(preview.again).toBe('10분')
    expect(preview.hard).toBe('1일')
    expect(preview.good).toBe('1일')
    expect(preview.easy).toBe('4일')
  })
})
