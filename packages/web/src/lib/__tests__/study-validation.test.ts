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

  // ── the plan session ──────────────────────────────────────────────────────
  //
  // These exist because the normalizer nearly ate the feature: it returns a CLOSED shape, so
  // the first working build passed `planSelection` into `initSession`, had it silently dropped
  // here, and studied the deck's ordinary due queue (75 cards) while the plan said 60. Nothing
  // failed — it just studied the wrong cards.
  const planSelection = () => ({
    goalId: 'goal-1',
    cardIds: ['card-1'],
    items: {
      'card-1': {
        id: 'item-1', activity_type: 'recall',
        response_type: 'self_rate', evaluator_type: 'self_rate',
      },
    },
  })

  it('carries a plan selection through instead of dropping it', () => {
    const config = normalizeStudyConfig({ ...base(), planSelection: planSelection() })
    expect(config.planSelection).toEqual(planSelection())
  })

  it('refuses a plan session in any mode but SRS', () => {
    // The other five send no SRS payload and reschedule nothing, so completing the day's items
    // from one would leave every planner input untouched — tomorrow's plan would be identical.
    for (const mode of ['cramming', 'random', 'sequential', 'sequential_review'] as const) {
      expect(() => normalizeStudyConfig({
        ...base(), mode, batchSize: 20,
        crammingFilter: { type: 'all' }, crammingTimeLimitMinutes: null,
        uploadDateStart: '2026-08-01', uploadDateEnd: '2026-08-02',
        planSelection: planSelection(),
      })).toThrow(StudyValidationError)
    }
  })

  it('refuses a selection with no cards, or an item missing its snapshot fields', () => {
    expect(() => normalizeStudyConfig({
      ...base(), planSelection: { ...planSelection(), cardIds: [] },
    })).toThrow(StudyValidationError)

    // `record_answer_attempt` asserts these three against the stored row and raises P0007 on a
    // mismatch, so a missing one has to stop the session starting, not the first rating.
    expect(() => normalizeStudyConfig({
      ...base(),
      planSelection: {
        goalId: 'goal-1', cardIds: ['card-1'],
        items: { 'card-1': { id: 'item-1', activity_type: 'recall' } },
      },
    })).toThrow(StudyValidationError)

    expect(() => normalizeStudyConfig({
      ...base(), planSelection: { ...planSelection(), items: {} },
    })).toThrow(StudyValidationError)
  })

  it('dedupes a repeated card id', () => {
    // The queue looks each id up once; a repeat would put the card in the session twice and the
    // second rating would be refused as a re-completion.
    const config = normalizeStudyConfig({
      ...base(),
      planSelection: { ...planSelection(), cardIds: ['card-1', 'card-1'] },
    })
    expect(config.planSelection?.cardIds).toEqual(['card-1'])
  })
})

// ── cardSelection ──────────────────────────────────────────────────────────
//
// "다시 볼 카드": study exactly the cards the diagnostics named. They are usually NOT due, so
// the ordinary SRS queue would never serve them — which is the whole reason this exists rather
// than a filter on the normal session.
describe('normalizeStudyConfig — cardSelection', () => {
  const base = () => ({ deckId: 'deck-1', mode: 'srs', batchSize: 20 })

  it('keeps the caller\'s order, because it is a ranking', () => {
    // Worst-scoring card first. Sorting would silently reorder the learner's queue.
    const config = normalizeStudyConfig({ ...base(), cardSelection: ['c', 'a', 'b'] })
    expect(config.cardSelection).toEqual(['c', 'a', 'b'])
  })

  it('drops a duplicate rather than rejecting the session', () => {
    // Studying one card twice in a queue asks the learner to rate a card whose schedule the
    // first rating already moved. A caller bug should not cost them the session.
    const config = normalizeStudyConfig({ ...base(), cardSelection: ['a', 'b', 'a'] })
    expect(config.cardSelection).toEqual(['a', 'b'])
  })

  it('refuses a non-SRS mode', () => {
    // Cramming moves no schedule (`modeFeedsSrsSchedule`), so re-studying a card the learner
    // keeps failing in one of those modes would change nothing about when it comes back.
    expect(() => normalizeStudyConfig({ ...base(), mode: 'cramming', cardSelection: ['a'] }))
      .toThrow(StudyValidationError)
  })

  it('refuses to hold both selections at once', () => {
    // Both name a queue and only one can win. Silently picking is how a learner ends up
    // studying something other than what they pressed.
    expect(() => normalizeStudyConfig({
      ...base(),
      planSelection: {
        goalId: 'goal-1', planDate: '2026-08-07', cardIds: ['a'],
        items: { a: { id: 'i1', activity_type: 'recall', response_type: 'self_rate', evaluator_type: 'self_rate' } },
      },
      cardSelection: ['a'],
    })).toThrow(StudyValidationError)
  })

  it('refuses an empty or malformed list instead of starting an empty session', () => {
    expect(() => normalizeStudyConfig({ ...base(), cardSelection: [] })).toThrow(StudyValidationError)
    expect(() => normalizeStudyConfig({ ...base(), cardSelection: 'a,b' })).toThrow(StudyValidationError)
    expect(() => normalizeStudyConfig({ ...base(), cardSelection: ['a', 42] })).toThrow(StudyValidationError)
  })

  it('is absent when not asked for', () => {
    expect(normalizeStudyConfig(base()).cardSelection).toBeUndefined()
  })
})
