import { describe, expect, it } from 'vitest'
import { buildRemediationPrompt, parseRemediationRefs, validateRemediationResult } from '../../../../../supabase/functions/_shared/ai-remediation.ts'

const id = '11111111-1111-4111-8111-111111111111'

describe('AI remediation contracts', () => {
  it('accepts only structured IDs and supported actions', () => {
    expect(parseRemediationRefs({ action: 'explain', goalId: id, uiLang: 'ko' })?.goalId).toBe(id)
    expect(parseRemediationRefs({ action: 'chat', goalId: id })).toBeNull()
    expect(parseRemediationRefs({ action: 'hint', goalId: 'not-an-id' })).toBeNull()
    expect(parseRemediationRefs({ action: 'hint' })).toBeNull()
  })

  it('requires source grounding for labor law', () => {
    const refs = parseRemediationRefs({ action: 'compare', goalId: id })!
    const prompt = buildRemediationPrompt(refs, { goal: { domain_id: 'labor-law' }, activity: null, attempt: null, cards: [], concepts: [], sources: [{ id, title: 'Act', citation: '§1' }] })
    expect(prompt.requireGrounding).toBe(true)
    expect(prompt.systemPrompt).toContain('Never invent source IDs')
  })

  // ── attempt grounding ─────────────────────────────────────────────────────
  //
  // These pin the difference between "the model was given evidence" and "the model was given a
  // placeholder it will read as evidence". Both are paid, learner-facing outputs.
  const groundedContext = (attempt: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
    goal: { domain_id: 'language' }, activity: null, attempt,
    cards: [], concepts: [], sources: [], ...extra,
  })

  it('tells the model to use the attempt only when there is one', () => {
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const ungrounded = buildRemediationPrompt(refs, groundedContext(null))
    expect(ungrounded.systemPrompt).not.toContain('The learner has attempted this item')

    const grounded = buildRemediationPrompt(refs, groundedContext({ normalized_score: 0 }))
    expect(grounded.systemPrompt).toContain('The learner has attempted this item')
  })

  it('never lets the model claim to know an answer the learner never wrote', () => {
    // Attempts store `{ self_rated: n }` — a rating, not a response. Without this line the
    // model happily writes "your answer confused X with Y" about text that does not exist.
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({ normalized_score: 0, response: { self_rated: 0 } }))
    expect(prompt.systemPrompt).toContain('do NOT')
    expect(prompt.systemPrompt).toContain('claim to know what the learner wrote')
  })

  it('strips hints_used / duration_ms when they are the unpopulated default', () => {
    // Both columns are NOT NULL DEFAULT 0 and nothing populates them, so `duration_ms: 0`
    // would reach the model as the assertion "answered in 0 ms" rather than as "unknown".
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({
      normalized_score: 0, hints_used: 0, duration_ms: 0,
    }))
    expect(prompt.userPrompt).not.toContain('duration_ms')
    expect(prompt.userPrompt).not.toContain('hints_used')
    expect(prompt.systemPrompt).toContain('were not recorded')
  })

  it('keeps them, and says so, once they carry a real value', () => {
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({
      normalized_score: 0, hints_used: 2, duration_ms: 8400,
    }))
    expect(prompt.userPrompt).toContain('8400')
    expect(prompt.systemPrompt).toContain('are populated for this attempt')
  })

  it('passes the same-card attempt history through to the model', () => {
    // The history is what turns one failure into a pattern; if it never reaches the payload
    // the feature is inert while still charging.
    const refs = parseRemediationRefs({ action: 'hint', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({ normalized_score: 0 }, {
      attemptHistory: [
        { normalized_score: 0, created_at: '2026-07-30T00:00:00.000Z' },
        { normalized_score: 0.5, created_at: '2026-07-29T00:00:00.000Z' },
      ],
    }))
    expect(prompt.userPrompt).toContain('attemptHistory')
    expect(prompt.userPrompt).toContain('2026-07-29T00:00:00.000Z')
    expect(prompt.systemPrompt).toContain('attemptHistory')
  })

  it('rejects invented citations and accepts grounded structured output', () => {
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const base = { action: 'explain', summary: 'Summary', blocks: [{ type: 'text', content: 'Grounded' }], confidence: 0.8, warnings: [] }
    expect(validateRemediationResult({ ...base, citations: [{ sourceId: '22222222-2222-4222-8222-222222222222' }] }, refs, [id], true).valid).toBe(false)
    const valid = validateRemediationResult({ ...base, citations: [{ sourceId: id, locator: '§1' }] }, refs, [id], true)
    expect(valid.valid).toBe(true)
  })
})
