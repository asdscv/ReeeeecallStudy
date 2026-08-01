import { describe, expect, it } from 'vitest'
import {
  buildRemediationPrompt, parseRemediationRefs, validateRemediationResult,
  REMEDIATION_ACTIONS, SERVED_REMEDIATION_ACTIONS,
} from '../../../../../supabase/functions/_shared/ai-remediation.ts'

const id = '11111111-1111-4111-8111-111111111111'

describe('AI remediation contracts', () => {
  it('accepts only structured IDs and supported actions', () => {
    expect(parseRemediationRefs({ action: 'explain', goalId: id, uiLang: 'ko' })?.goalId).toBe(id)
    expect(parseRemediationRefs({ action: 'chat', goalId: id })).toBeNull()
    expect(parseRemediationRefs({ action: 'hint', goalId: 'not-an-id' })).toBeNull()
    expect(parseRemediationRefs({ action: 'hint' })).toBeNull()
  })

  // ── which actions this server will actually run ───────────────────────────
  //
  // This was previously enforced ONLY by a client type alias, which constrains our UI and
  // nothing about the request an authenticated caller can POST.
  it('refuses an action it cannot perform honestly, before any wallet is touched', () => {
    // Every one of these is in the protocol vocabulary and passes the SQL allowlists, so the
    // edge function is the only thing standing between them and a charged, invented answer.
    for (const action of ['compare', 'evaluate', 'generate', 'recommend']) {
      expect(parseRemediationRefs({ action, goalId: id }), action).toBeNull()
    }
  })

  it('serves exactly the two actions an attempt can ground', () => {
    expect([...SERVED_REMEDIATION_ACTIONS]).toEqual(['explain', 'hint'])
    for (const action of SERVED_REMEDIATION_ACTIONS) {
      expect(parseRemediationRefs({ action, goalId: id }), action).not.toBeNull()
    }
  })

  it('keeps the served list a strict subset of the protocol vocabulary', () => {
    // The SQL allowlists (reserve/persist) accept all six by design — they are the protocol
    // layer. A served action outside that set would be refused by the database after being
    // charged, which is the worst of both.
    for (const action of SERVED_REMEDIATION_ACTIONS) {
      expect(REMEDIATION_ACTIONS, action).toContain(action)
    }
    expect(SERVED_REMEDIATION_ACTIONS.length).toBeLessThan(REMEDIATION_ACTIONS.length)
  })

  it('requires source grounding for labor law', () => {
    // Was written against `compare`, which the server no longer serves. Grounding is
    // action-independent, so the assertion is unchanged — only the action it rides on.
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
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
