/**
 * validateWeakThemes — the boundary that keeps a model's answer renderable.
 *
 * The feature this replaces let the model return free-form `blocks[]`, which no view could be
 * written for, so the screen printed the JSON at the learner. Here the model returns labels
 * from a closed set and card ids it was given; everything else is dropped. These cases are the
 * ways a real model gets that wrong.
 */
import { describe, it, expect } from 'vitest'
import {
  validateWeakThemes, isWeakTheme, WEAK_THEMES, WEAK_THEME_MIN_CONFIDENCE,
} from '@reeeeecall/shared/lib/weak-themes'

const ALLOWED = ['a', 'b', 'c']
const ok = (over: Record<string, unknown> = {}) =>
  ({ themes: [{ theme: 'similar_meaning', cardIds: ['a', 'b'], confidence: 0.9, ...over }] })

describe('isWeakTheme', () => {
  it('accepts only the closed set', () => {
    for (const theme of WEAK_THEMES) expect(isWeakTheme(theme)).toBe(true)
    expect(isWeakTheme('verb_conjugation')).toBe(false)
    expect(isWeakTheme('')).toBe(false)
    expect(isWeakTheme(null)).toBe(false)
  })
})

describe('validateWeakThemes', () => {
  it('keeps a well-formed finding', () => {
    expect(validateWeakThemes(ok(), ALLOWED))
      .toEqual([{ theme: 'similar_meaning', cardIds: ['a', 'b'], confidence: 0.9 }])
  })

  it('drops a card id it was never asked about', () => {
    // The load-bearing check. A model returning an unknown id is hallucinating or has been
    // steered by card content, and the finding would point at a card unrelated to the failures.
    expect(validateWeakThemes(ok({ cardIds: ['a', 'b', 'ELSEWHERE'] }), ALLOWED))
      .toEqual([{ theme: 'similar_meaning', cardIds: ['a', 'b'], confidence: 0.9 }])
  })

  it('drops the whole finding when too few valid ids survive', () => {
    // One card cannot have a "pattern". Rendering "these 1 cards look alike" is nonsense.
    expect(validateWeakThemes(ok({ cardIds: ['a', 'NOPE'] }), ALLOWED)).toEqual([])
  })

  it('refuses a label outside the set', () => {
    // Anything invented has no translated string, so it would render as a raw identifier —
    // which is exactly how the previous feature leaked "ACTION / explain" to a learner.
    expect(validateWeakThemes(ok({ theme: 'kanji_reading' }), ALLOWED)).toEqual([])
  })

  it('discards `no_pattern` rather than rendering it', () => {
    // The model MUST be able to say "nothing in common" or it will invent something. But that
    // is an instruction to show nothing, not a finding to display.
    expect(validateWeakThemes(ok({ theme: 'no_pattern' }), ALLOWED)).toEqual([])
  })

  it('suppresses a hedged guess', () => {
    expect(validateWeakThemes(ok({ confidence: WEAK_THEME_MIN_CONFIDENCE - 0.01 }), ALLOWED))
      .toEqual([])
    expect(validateWeakThemes(ok({ confidence: WEAK_THEME_MIN_CONFIDENCE }), ALLOWED))
      .toHaveLength(1)
  })

  it('never lets two findings claim the same card', () => {
    // Two explanations of one failure contradict each other on screen. First finding wins,
    // and the second is dropped once it falls below the minimum.
    const out = validateWeakThemes({
      themes: [
        { theme: 'similar_meaning', cardIds: ['a', 'b'], confidence: 0.9 },
        { theme: 'similar_form', cardIds: ['a', 'b'], confidence: 0.8 },
      ],
    }, ALLOWED)

    expect(out).toHaveLength(1)
    expect(out[0].theme).toBe('similar_meaning')
  })

  it('returns the strongest finding first', () => {
    const out = validateWeakThemes({
      themes: [
        { theme: 'multi_part', cardIds: ['a', 'b'], confidence: 0.6 },
        { theme: 'similar_form', cardIds: ['c', 'a'], confidence: 0.95 },
      ],
    }, ALLOWED)

    // 'similar_form' wins on confidence; it claims 'c' and 'a', leaving multi_part one card.
    expect(out.map((f) => f.theme)).toEqual(['similar_form'])
  })

  it('survives every shape a broken response can take', () => {
    for (const bad of [null, undefined, 'themes', 42, {}, { themes: null }, { themes: {} },
      { themes: [null] }, { themes: [{}] }, ok({ confidence: 'high' }),
      ok({ confidence: Number.NaN }), ok({ cardIds: 'a,b' })]) {
      expect(validateWeakThemes(bad, ALLOWED)).toEqual([])
    }
  })
})
