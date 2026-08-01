/**
 * cardPromptLabel — what a plan row shows the learner.
 *
 * The bug these protect against was visible on a simulator: every row of today's plan showed
 * the ENGLISH MEANING of the word instead of the word. `field_values` is jsonb, and Postgres
 * returns its keys shortest-then-bytewise, so `{ front, back }` arrives as `{ back, front }`
 * and "the first value" is the answer.
 */
import { describe, it, expect } from 'vitest'
import { cardPromptLabel } from '@reeeeecall/shared/lib/card-prompt'

describe('cardPromptLabel', () => {
  it('shows the prompt, not the answer, when jsonb reorders the keys', () => {
    // Exactly what PostgREST returns for a card written as { front: '重複', back: '…' }.
    const fromDb = { back: 'duplication / overlap', front: '重複' }

    expect(cardPromptLabel(fromDb)).toBe('重複')
  })

  it('follows the template order when the template is known', () => {
    const card = { field_2: '뜻', field_1: '한자' }

    expect(cardPromptLabel(card, 'tpl-1', { 'tpl-1': ['field_1', 'field_2'] })).toBe('한자')
    // A template that genuinely reads meaning-first is honoured, not overridden.
    expect(cardPromptLabel(card, 'tpl-2', { 'tpl-2': ['field_2', 'field_1'] })).toBe('뜻')
  })

  it('skips a template field the card left empty', () => {
    const card = { field_1: '   ', field_2: '뜻' }

    // An empty first field is not a label; falling through beats rendering blank.
    expect(cardPromptLabel(card, 'tpl-1', { 'tpl-1': ['field_1', 'field_2'] })).toBe('뜻')
  })

  it('falls back to a conventional prompt key for an unknown template', () => {
    expect(cardPromptLabel({ meaning: 'deduction', term: '控除' })).toBe('控除')
    expect(cardPromptLabel({ answer: 'Paris', question: 'Capital of France?' }))
      .toBe('Capital of France?')
  })

  it('prefers any non-answer field over a known answer field', () => {
    // No conventional prompt key at all; `notes` is at least not the answer.
    expect(cardPromptLabel({ back: 'the answer', notes: 'chapter 3' })).toBe('chapter 3')
  })

  it('shows the answer only when it is the single field there is', () => {
    // Nothing left to spoil, and an empty row would tell the learner nothing.
    expect(cardPromptLabel({ back: 'the answer' })).toBe('the answer')
  })

  it('returns an empty string for a card with nothing readable', () => {
    expect(cardPromptLabel({})).toBe('')
    expect(cardPromptLabel({ front: '  ' })).toBe('')
    expect(cardPromptLabel(null)).toBe('')
    expect(cardPromptLabel(undefined)).toBe('')
  })
})
