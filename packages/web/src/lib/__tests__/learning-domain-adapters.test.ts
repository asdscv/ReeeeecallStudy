import { describe, expect, it } from 'vitest'
import { activitiesForLegacyCard, assertImplementedMedia, laborLawDomainAdapter, languageDomainAdapter, LABOR_LAW_ISSUE_RULE_APPLICATION_CONCLUSION_RUBRIC } from '@reeeeecall/shared/learning'
import type { Card } from '@reeeeecall/shared/types/database'

const card: Card = {
  id: 'card-1', deck_id: 'deck-1', user_id: 'user-1', template_id: 'template-1',
  field_values: { front: '안녕', back: 'hello' }, tags: [], sort_position: 1,
  srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
  next_review_at: null, last_reviewed_at: null,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
}

describe('learning domain adapters', () => {
  it('projects a legacy card as a transient recall activity without mutation', () => {
    const activities = activitiesForLegacyCard({ card, persistedActivities: [], frontFieldKeys: ['front'], backFieldKeys: ['back'] })
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({ cardId: 'card-1', activityType: 'recall', config: { transient: true } })
    expect(activities[0]?.stimulus).toEqual({ fields: { front: '안녕' } })
  })

  // ── expectedResponse: absent beats wrong ──────────────────────────────────
  //
  // Nothing grades against this today (`legacyCardItemShape` discards it), which is exactly
  // why it needs pinning: the moment something does, "the expected answer is the question"
  // would be confidently wrong rather than unavailable.
  it('gives the declared back as the expected answer when the caller names the fields', () => {
    const [activity] = activitiesForLegacyCard({
      card, persistedActivities: [], frontFieldKeys: ['front'], backFieldKeys: ['back'],
    })
    expect(activity?.expectedResponse).toEqual({ fields: { back: 'hello' } })
  })

  it('returns NO expected answer rather than echoing the stimulus', () => {
    // One field, so there is no back to find. The old code fell back to the front, making
    // expectedResponse identical to stimulus — an answer that is the question.
    const oneField: Card = { ...card, field_values: { front: '안녕' } }

    const [activity] = activitiesForLegacyCard({ card: oneField, persistedActivities: [] })

    expect(activity?.expectedResponse).toBeNull()
    expect(activity?.expectedResponse).not.toEqual(activity?.stimulus)
  })

  it('never lets a positional guess become the expected answer', () => {
    // No field keys supplied — the only way production calls it (learning-candidates.ts). The
    // positional pick is a shape-compatibility shim, and jsonb key ordering means it can invert
    // front and back outright, so it must not be presented as a graded reference.
    const [activity] = activitiesForLegacyCard({ card, persistedActivities: [] })

    expect(activity?.expectedResponse).not.toEqual(activity?.stimulus)
  })

  it('suppresses synthesized fallback when a persisted recall activity exists', () => {
    const persisted = { ...activitiesForLegacyCard({ card, persistedActivities: [] })[0]!, id: 'persisted', config: { transient: false } }
    expect(activitiesForLegacyCard({ card, persistedActivities: [persisted] })).toEqual([persisted])
  })

  it('keeps language ActivityType independent from StudyMode', () => {
    expect(languageDomainAdapter.supportedActivityTypes).toEqual(['recall', 'practice', 'produce'])
    expect(languageDomainAdapter.supportedActivityTypes).not.toContain('srs')
  })

  it('defines a source-grounded non-language production rubric', () => {
    expect(laborLawDomainAdapter.promptPolicy?.requireSourceGrounding).toBe(true)
    expect(LABOR_LAW_ISSUE_RULE_APPLICATION_CONCLUSION_RUBRIC.criteria.map((item) => item.id)).toEqual(['issue', 'rule', 'application', 'conclusion'])
  })

  it('fails explicitly for deferred speech/audio capabilities', () => {
    expect(() => assertImplementedMedia({ stimulusType: 'audio', responseType: 'audio', evaluatorType: 'speech' })).toThrow(/Unsupported speech\/audio activity/)
  })
})
