import { describe, expect, it } from 'vitest'
import {
  StudyValidationError,
  isStudyMode,
  normalizeRatingForMode,
  normalizeStudyConfig,
} from '@reeeeecall/shared/lib/study-validation'

const base = () => ({ deckId: 'deck-1', mode: 'srs' as const, batchSize: 20 })

describe('study-validation', () => {
  it('accepts only the six supported study modes', () => {
    for (const mode of ['srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming']) {
      expect(isStudyMode(mode)).toBe(true)
    }
    expect(isStudyMode('bogus')).toBe(false)
    expect(isStudyMode(null)).toBe(false)
  })

  it('rounds and clamps finite batch sizes', () => {
    expect(normalizeStudyConfig({ ...base(), batchSize: 0 }).batchSize).toBe(1)
    expect(normalizeStudyConfig({ ...base(), batchSize: 20.6 }).batchSize).toBe(21)
    expect(normalizeStudyConfig({ ...base(), batchSize: 50_000 }).batchSize).toBe(1000)
  })

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite batch size: %s', (batchSize) => {
    expect(() => normalizeStudyConfig({ ...base(), batchSize })).toThrow(StudyValidationError)
  })

  it('rejects an empty deck id and unknown mode', () => {
    expect(() => normalizeStudyConfig({ ...base(), deckId: '  ' })).toThrow(/deckId/)
    expect(() => normalizeStudyConfig({ ...base(), mode: 'bogus' as never })).toThrow(/mode/)
  })

  it('requires an ordered valid date range for by_date mode', () => {
    expect(() => normalizeStudyConfig({ ...base(), mode: 'by_date' })).toThrow(/date range/)
    expect(() => normalizeStudyConfig({
      ...base(), mode: 'by_date',
      uploadDateStart: '2026-07-30T00:00:00.000Z',
      uploadDateEnd: '2026-07-29T23:59:59.999Z',
    })).toThrow(/date range/)

    const normalized = normalizeStudyConfig({
      ...base(), mode: 'by_date',
      uploadDateStart: '2026-07-29T00:00:00.000Z',
      uploadDateEnd: '2026-07-29T23:59:59.999Z',
    })
    expect(normalized.uploadDateStart).toBe('2026-07-29T00:00:00.000Z')
  })

  it.each([-1, NaN, Infinity])('rejects invalid cramming time: %s', (value) => {
    expect(() => normalizeStudyConfig({
      ...base(), mode: 'cramming', crammingTimeLimitMinutes: value,
    })).toThrow(/time limit/)
  })

  it('normalizes cramming filters without retaining caller-owned arrays', () => {
    const tags = [' weak ', 'verb', 'verb']
    const normalized = normalizeStudyConfig({
      ...base(), mode: 'cramming', crammingFilter: { type: 'tags', tags },
    })
    expect(normalized.crammingFilter).toEqual({ type: 'tags', tags: ['weak', 'verb'] })
    expect((normalized.crammingFilter as { tags: string[] }).tags).not.toBe(tags)
  })

  it('rejects malformed cramming filters', () => {
    expect(() => normalizeStudyConfig({
      ...base(), mode: 'cramming', crammingFilter: { type: 'weak', maxEaseFactor: NaN },
    })).toThrow(/filter/)
    expect(() => normalizeStudyConfig({
      ...base(), mode: 'cramming', crammingFilter: { type: 'tags', tags: [] },
    })).toThrow(/filter/)
  })

  it('normalizes ratings per mode and rejects cross-mode values', () => {
    expect(normalizeRatingForMode('srs', 'good')).toBe('good')
    expect(normalizeRatingForMode('srs', 'known')).toBeNull()
    expect(normalizeRatingForMode('cramming', 'known')).toBe('got_it')
    expect(normalizeRatingForMode('cramming', 'unknown')).toBe('missed')
    expect(normalizeRatingForMode('cramming', 'anything')).toBeNull()
    expect(normalizeRatingForMode('sequential', 'next')).toBe('next')
    expect(normalizeRatingForMode('random', 'again')).toBeNull()
  })
})
