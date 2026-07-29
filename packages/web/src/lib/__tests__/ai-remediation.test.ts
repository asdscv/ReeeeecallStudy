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

  it('rejects invented citations and accepts grounded structured output', () => {
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const base = { action: 'explain', summary: 'Summary', blocks: [{ type: 'text', content: 'Grounded' }], confidence: 0.8, warnings: [] }
    expect(validateRemediationResult({ ...base, citations: [{ sourceId: '22222222-2222-4222-8222-222222222222' }] }, refs, [id], true).valid).toBe(false)
    const valid = validateRemediationResult({ ...base, citations: [{ sourceId: id, locator: '§1' }] }, refs, [id], true)
    expect(valid.valid).toBe(true)
  })
})
