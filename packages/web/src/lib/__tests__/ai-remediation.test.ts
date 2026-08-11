import { describe, expect, it } from 'vitest'
import {
  buildRemediationPrompt, parseRemediationRefs, validateRemediationResult,
  REMEDIATION_ACTIONS, SERVED_REMEDIATION_ACTIONS, compareGroundingError,
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
    // `compare` left this list once BOTH halves of its premise existed — typed answers and a
    // template-declared reference. The rest still have none.
    for (const action of ['evaluate', 'generate', 'recommend']) {
      expect(parseRemediationRefs({ action, goalId: id }), action).toBeNull()
    }
  })

  it('serves exactly the actions an attempt can ground', () => {
    expect([...SERVED_REMEDIATION_ACTIONS]).toEqual(['explain', 'hint', 'compare'])
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
    // An attempt with a rating and no text. Without this line the model happily writes "your
    // answer confused X with Y" about text that does not exist.
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({ normalized_score: 0, response: { self_rated: 0 } }))
    expect(prompt.systemPrompt).toContain('Do NOT claim to')
    expect(prompt.systemPrompt).toContain('know what they wrote')
  })

  it('stops disclaiming once the learner HAS written something', () => {
    // The disclaimer used to fire on "an attempt exists", which is a different question. Once
    // typed answers started arriving it told the model to deny an answer it had been handed.
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext({
      normalized_score: 0, response: { self_rated: 0, text: 'a fruit' },
    }))

    expect(prompt.systemPrompt).not.toContain('Do NOT claim to')
    expect(prompt.systemPrompt).toContain('is what the learner actually wrote')
  })

  // ── compare: refuse, never degrade ────────────────────────────────────────
  it('refuses a compare with nothing typed, and one with no reference, distinctly', () => {
    // Two different situations for the learner: one they can fix by writing an answer, one they
    // cannot fix at all. A single generic failure would leave them guessing which.
    expect(compareGroundingError({ response: { self_rated: 0 } }, { text: '사과' }))
      .toBe('NO_LEARNER_ANSWER')
    expect(compareGroundingError({ response: { self_rated: 0, text: '   ' } }, { text: '사과' }))
      .toBe('NO_LEARNER_ANSWER')
    expect(compareGroundingError({ response: { self_rated: 0, text: 'apple' } }, null))
      .toBe('NO_REFERENCE_ANSWER')
    expect(compareGroundingError({ response: { self_rated: 0, text: 'apple' } }, { text: '  ' }))
      .toBe('NO_REFERENCE_ANSWER')
  })

  it('allows a compare that has both halves', () => {
    expect(compareGroundingError({ response: { self_rated: 0, text: 'apple' } }, { text: '사과' }))
      .toBeNull()
  })

  it('tells the model to compare against the CARD\'s answer, not its own idea of one', () => {
    const refs = parseRemediationRefs({ action: 'compare', goalId: id })!
    const prompt = buildRemediationPrompt(refs, groundedContext(
      { normalized_score: 0, response: { self_rated: 0, text: 'a red fruit' } },
      { expectedAnswer: { keys: ['back'], text: '사과' } },
    ))

    expect(prompt.systemPrompt).toContain('which is the answer THIS CARD')
    // A paraphrase is correct — the learner is being tested on recall, not on phrasing.
    expect(prompt.systemPrompt).toContain('means the same thing is CORRECT')
    // And the reference reaches the model.
    expect(prompt.userPrompt).toContain('사과')
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

  /**
   * The trap this feature would have shipped with.
   *
   * `requireGrounding` is `context.sources.length > 0`, and sources come from
   * `content_sources` — whose only writers (`create_private_source` and friends) have no
   * TypeScript caller at all. So on every real request the list is EMPTY, and the schema line
   * in the prompt still names a `citations` field. A model that helpfully filled it in cited
   * an id that could not exist, the validator rejected the whole result, and a paid request
   * came back as a 502. The learner is not charged — the job is released — but the provider
   * tokens are spent and the feature simply does not work.
   */
  describe('when no sources were supplied', () => {
    const refs = parseRemediationRefs({ action: 'explain', goalId: id })!
    const base = {
      action: 'explain', summary: 'Summary',
      blocks: [{ type: 'text', content: 'Ungrounded but useful' }], warnings: [],
    }

    it('tells the model to send no citations at all', () => {
      const prompt = buildRemediationPrompt(refs, {
        goal: {}, activity: null, attempt: {}, cards: [], concepts: [], sources: [],
      })
      expect(prompt.requireGrounding).toBe(false)
      expect(prompt.systemPrompt).toMatch(/citations MUST be an empty array/i)
    })

    it('survives a model that volunteers one anyway', () => {
      // Dropped, not fatal. The citation points at nothing renderable, and failing a paid
      // request over a field the learner never sees is worse than ignoring it.
      const out = validateRemediationResult(
        { ...base, citations: [{ sourceId: '22222222-2222-4222-8222-222222222222' }] },
        refs, [], false)
      expect(out.valid).toBe(true)
      if (out.valid) expect(out.sourceIds).toEqual([])
    })

    it('still refuses an invented citation when grounding WAS required', () => {
      // The case the validator exists for must keep working: sources were supplied and the
      // model cited one it was not given.
      expect(validateRemediationResult(
        { ...base, citations: [{ sourceId: '22222222-2222-4222-8222-222222222222' }] },
        refs, [id], true).valid).toBe(false)
    })

    it('still refuses a citation that is not even an object', () => {
      expect(validateRemediationResult(
        { ...base, citations: ['nope'] }, refs, [], false).valid).toBe(false)
    })

    it('does not invite the model to explain the citation rule to the learner', () => {
      // The first live call against the deployed function returned, verbatim: "No sources were
      // supplied, so citations are empty." That is our plumbing, printed under a paid answer,
      // for someone who never made a request and cannot supply a source. It was invited by
      // pairing the citations rule with "state uncertainty in warnings" one clause later.
      const prompt = buildRemediationPrompt(refs, {
        goal: {}, activity: null, attempt: {}, cards: [], concepts: [], sources: [],
      })
      const citationRule = prompt.systemPrompt
        .split('\n').find((line) => /citations MUST be an empty array/i.test(line))!
      expect(citationRule).not.toMatch(/warnings/i)
      expect(prompt.systemPrompt).toMatch(/Never mention[\s\S]*citations/i)
    })
  })

  /**
   * The learner reads the caveats too.
   *
   * Live, `uiLang: 'ko'` produced a Korean summary and English warnings, because the locale
   * line said "learner-facing text" and the model scoped that to the prose. A hedge the learner
   * cannot read is worse than no hedge: it looks like the answer came with a disclaimer, and
   * they have no way to find out it said "I could not determine the reason".
   */
  describe('the locale instruction', () => {
    it('names the warnings, not just the prose', () => {
      const refs = parseRemediationRefs({ action: 'explain', goalId: id, uiLang: 'ko' })!
      const prompt = buildRemediationPrompt(refs, {
        goal: {}, activity: null, attempt: {}, cards: [], concepts: [], sources: [],
      })
      const locale = prompt.systemPrompt.split('\n').find((line) => /locale ko/.test(line))!
      expect(locale).toMatch(/warning/i)
      expect(locale).toMatch(/summary/i)
      expect(locale).toMatch(/block/i)
    })

    it('does not let the material\'s own language override the learner\'s', () => {
      // An English deck is the normal case for every non-English locale here — that is what a
      // language learner studies. The model must not answer in the language it is reading.
      const refs = parseRemediationRefs({ action: 'explain', goalId: id, uiLang: 'th' })!
      const prompt = buildRemediationPrompt(refs, {
        goal: {}, activity: null, attempt: {},
        cards: [{ id, front: 'auction', back: 'ˈɔːkʃən' }], concepts: [], sources: [],
      })
      expect(prompt.systemPrompt).toMatch(/locale th/)
      expect(prompt.systemPrompt).toMatch(/whatever language the learning material itself is in/i)
    })
  })
})
