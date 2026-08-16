import { describe, it, expect } from 'vitest'
import { splitBySpan } from '@reeeeecall/shared/lib/quiz-feedback'

/**
 * A highlight reads as "this is the part that counted", so it has to sit on whole words.
 *
 * The offsets come from the grading model and are counted in characters, which is a unit that
 * knows nothing about words. Measured on production: an answer reading
 * "breeze는 산들바람이라는 뜻입니다..." came back with a span that started inside 산들바람 and
 * ended inside the particle, and the screen highlighted "바람이라는" — the word cut in half.
 */
describe('splitBySpan', () => {
  it('grows a mid-word span out to the whole word', () => {
    const text = 'breeze는 산들바람이라는 뜻입니다.'
    // Exactly the production span: starts inside 산들바람, ends inside the particle.
    const { before, hit, after } = splitBySpan(text, { from: 'learner', start: 11, end: 14 })
    expect(hit).toBe('산들바람이라는')
    expect(before).toBe('breeze는 ')
    expect(after).toBe(' 뜻입니다.')
    // The three pieces must still reassemble into the original, or the screen has invented text.
    expect(before + hit + after).toBe(text)
  })

  it('leaves a span that already sits on boundaries alone', () => {
    const text = 'The breeze was there.'
    expect(splitBySpan(text, { from: 'learner', start: 4, end: 10 }).hit).toBe('breeze')
  })

  it('snaps both ends, not just the start', () => {
    const text = 'a gentle breeze indeed'
    expect(splitBySpan(text, { from: 'learner', start: 3, end: 12 }).hit).toBe('gentle breeze')
  })

  it('says "no highlight" rather than throwing on a span it cannot use', () => {
    const text = 'short'
    for (const span of [
      null,
      { from: 'learner' as const, start: -1, end: 3 },
      { from: 'learner' as const, start: 0, end: 99 },
      { from: 'learner' as const, start: 3, end: 3 },
    ]) {
      expect(splitBySpan(text, span)).toEqual({ before: text, hit: '', after: '' })
    }
  })
})
