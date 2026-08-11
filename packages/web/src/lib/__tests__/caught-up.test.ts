/**
 * What "nothing due" actually means.
 *
 * A learner finished all twelve of today's items, pressed 더 하기, and the screen replaced
 * their day with 「오늘 이 덱들에서 복습할 카드가 없습니다」. They read it as the app having lost
 * their cards, and nothing on the screen contradicted that — the card above it was
 * simultaneously claiming twelve reviews were overdue.
 *
 * The true state was the least alarming of the three this sentence collapses: twelve cards
 * were sitting in 1- and 10-minute learning steps, due back within the hour. The bug is that
 * one sentence covered all three, and the only one it sounded like was the bad one.
 */
import { describe, it, expect } from 'vitest'
import { caughtUp, SOON_MINUTES } from '@reeeeecall/shared/lib/caught-up'

const NOW = '2026-08-11T15:00:00.000Z'
const plus = (minutes: number) =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString()

describe('caughtUp', () => {
  it('calls a card returning in minutes "soon", not an empty goal', () => {
    // The reported state. These are cards the learner answered ninety seconds ago.
    const out = caughtUp(plus(9), NOW)
    expect(out.kind).toBe('soon')
    expect(out.minutes).toBe(9)
  })

  it('treats the hour boundary as soon, and past it as a date', () => {
    expect(caughtUp(plus(SOON_MINUTES), NOW).kind).toBe('soon')
    expect(caughtUp(plus(SOON_MINUTES + 1), NOW).kind).toBe('later')
  })

  it('carries the instant so a later review can be named', () => {
    const at = plus(26 * 60)
    const out = caughtUp(at, NOW)
    expect(out.kind).toBe('later')
    expect(out.atISO).toBe(at)
  })

  it('rounds up, and never says zero minutes', () => {
    // "0분 뒤" is not a wait, and a learner reading it would refresh rather than pause.
    expect(caughtUp(plus(0.2), NOW).minutes).toBe(1)
    expect(caughtUp(plus(4.1), NOW).minutes).toBe(5)
  })

  it('reads an already-passed instant as soon, not as a negative wait', () => {
    // The clock moved between the read and the render. The row IS due, so the learner is
    // about to be handed work — the honest floor is "any moment", never "-3분".
    const out = caughtUp(plus(-3), NOW)
    expect(out.kind).toBe('soon')
    expect(out.minutes).toBe(1)
  })

  it('is "empty" only when nothing is scheduled at all', () => {
    // The one case that is genuinely bad news and the only one that should ask the learner
    // for anything. Distinguishing it is the whole point of the module.
    for (const missing of [null, undefined, '']) {
      expect(caughtUp(missing, NOW).kind).toBe('empty')
    }
    expect(caughtUp(null, NOW).minutes).toBeNull()
    expect(caughtUp(null, NOW).atISO).toBeNull()
  })

  it('refuses to guess from an unparseable instant', () => {
    // A server that sent something unexpected must produce the plain empty state, never a
    // NaN-minute countdown rendered as "NaN분쯤 뒤에".
    expect(caughtUp('not-a-date', NOW).kind).toBe('empty')
    expect(caughtUp(plus(5), 'not-a-date').kind).toBe('empty')
  })
})
