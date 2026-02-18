import { describe, it, expect } from 'vitest'
import {
  computeSequentialReviewPositions,
  STUDY_MODE_OPTIONS,
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  isBatchSizeConfigurable,
  clampBatchSize,
} from '../study-session-utils'

// ─── STUDY_MODE_OPTIONS ─────────────────────────────────────

describe('STUDY_MODE_OPTIONS', () => {
  it('has 5 modes', () => {
    expect(STUDY_MODE_OPTIONS).toHaveLength(5)
  })

  it('includes srs, sequential_review, random, sequential, by_date', () => {
    const values = STUDY_MODE_OPTIONS.map(o => o.value)
    expect(values).toEqual(['srs', 'sequential_review', 'random', 'sequential', 'by_date'])
  })

  it('each option has emoji, label, desc', () => {
    for (const opt of STUDY_MODE_OPTIONS) {
      expect(opt.emoji.length).toBeGreaterThan(0)
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.desc.length).toBeGreaterThan(0)
    }
  })
})

// ─── isBatchSizeConfigurable ────────────────────────────────

describe('isBatchSizeConfigurable', () => {
  it('returns false for srs mode', () => {
    expect(isBatchSizeConfigurable('srs')).toBe(false)
  })

  it('returns false for by_date mode', () => {
    expect(isBatchSizeConfigurable('by_date')).toBe(false)
  })

  it('returns true for sequential_review', () => {
    expect(isBatchSizeConfigurable('sequential_review')).toBe(true)
  })

  it('returns true for random', () => {
    expect(isBatchSizeConfigurable('random')).toBe(true)
  })

  it('returns true for sequential', () => {
    expect(isBatchSizeConfigurable('sequential')).toBe(true)
  })
})

// ─── clampBatchSize ─────────────────────────────────────────

describe('clampBatchSize', () => {
  it('returns value within range unchanged', () => {
    expect(clampBatchSize(20)).toBe(20)
    expect(clampBatchSize(100)).toBe(100)
  })

  it('clamps below minimum to MIN_BATCH_SIZE', () => {
    expect(clampBatchSize(0)).toBe(MIN_BATCH_SIZE)
    expect(clampBatchSize(-5)).toBe(MIN_BATCH_SIZE)
  })

  it('clamps above maximum to MAX_BATCH_SIZE', () => {
    expect(clampBatchSize(999)).toBe(MAX_BATCH_SIZE)
  })

  it('rounds to nearest integer', () => {
    expect(clampBatchSize(20.7)).toBe(21)
    expect(clampBatchSize(10.3)).toBe(10)
  })

  it('returns default for NaN/Infinity', () => {
    expect(clampBatchSize(NaN)).toBe(DEFAULT_BATCH_SIZE)
    expect(clampBatchSize(Infinity)).toBe(DEFAULT_BATCH_SIZE)
  })
})

// ─── Constants ──────────────────────────────────────────────

describe('batch size constants', () => {
  it('DEFAULT_BATCH_SIZE is 20', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(20)
  })

  it('MIN_BATCH_SIZE is 1', () => {
    expect(MIN_BATCH_SIZE).toBe(1)
  })

  it('MAX_BATCH_SIZE is 200', () => {
    expect(MAX_BATCH_SIZE).toBe(200)
  })
})

// ─── computeSequentialReviewPositions ───────────────────────

describe('computeSequentialReviewPositions', () => {
  it('advances new_start_pos and shifts review window to previous new batch', () => {
    const queue = [
      { sort_position: 0, srs_status: 'new' as const },
      { sort_position: 5, srs_status: 'new' as const },
      { sort_position: 9, srs_status: 'new' as const },
    ]
    const state = { new_start_pos: 0, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state)

    expect(result.new_start_pos).toBe(10)
    expect(result.review_start_pos).toBe(0)
  })

  it('sets review window so next session can review previously learned cards', () => {
    const queue = [
      { sort_position: 10, srs_status: 'new' as const },
      { sort_position: 15, srs_status: 'new' as const },
      { sort_position: 19, srs_status: 'new' as const },
      { sort_position: 0, srs_status: 'learning' as const },
      { sort_position: 5, srs_status: 'review' as const },
    ]
    const state = { new_start_pos: 10, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state)

    expect(result.new_start_pos).toBe(20)
    expect(result.review_start_pos).toBe(10)
  })

  it('does not change positions when queue is empty', () => {
    const state = { new_start_pos: 10, review_start_pos: 5 }
    const result = computeSequentialReviewPositions([], state)

    expect(result.new_start_pos).toBe(10)
    expect(result.review_start_pos).toBe(5)
  })

  it('keeps new_start_pos unchanged when no new cards in queue (only review)', () => {
    const queue = [
      { sort_position: 3, srs_status: 'learning' as const },
      { sort_position: 7, srs_status: 'review' as const },
    ]
    const state = { new_start_pos: 10, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state)

    expect(result.new_start_pos).toBe(10)
    // review_start_pos advances past the last studied review card (pos 7 + 1 = 8)
    expect(result.review_start_pos).toBe(8)
  })
})
