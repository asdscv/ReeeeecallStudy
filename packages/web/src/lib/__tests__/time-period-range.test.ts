/**
 * The window a period selects.
 *
 * Every chart, stat and list row on the history page is filtered by this one function, so an
 * off-by-one at either end is an off-by-one everywhere at once — and it shows up as a number
 * being slightly wrong, which nobody reports and nobody can spot by looking.
 *
 * The end-of-day boundary is the case worth pinning: a learner who picks 8월 6일 as the end
 * means ALL of the 6th. Taking `to` at midnight silently drops a whole day of study from the
 * last day of every custom range — the day they most likely wanted to see.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveRange, rangeDays, toDateKey, periodToDays,
} from '../time-period'

const NOW = new Date('2026-08-11T15:30:00')
const at = (iso: string) => new Date(iso).getTime()

describe('resolveRange', () => {
  it('a preset ends at the end of TODAY, not at this instant', () => {
    // Sessions finished later this afternoon must be inside "last 7 days", or today's own
    // study is missing from today's chart until midnight.
    const r = resolveRange('1w', null, NOW)!
    expect(r.toMs).toBe(at('2026-08-11T23:59:59.999'))
  })

  it('a preset counts N days INCLUDING today', () => {
    // "1주" is 7 days ending today: Aug 5 through Aug 11, not Aug 4.
    const r = resolveRange('1w', null, NOW)!
    expect(r.fromMs).toBe(at('2026-08-05T00:00:00'))
    expect(rangeDays(r)).toBe(7)
  })

  it('1d is today alone', () => {
    const r = resolveRange('1d', null, NOW)!
    expect(r.fromMs).toBe(at('2026-08-11T00:00:00'))
    expect(rangeDays(r)).toBe(1)
  })

  it('a custom range covers BOTH end days in full', () => {
    const r = resolveRange('custom', { from: '2026-07-20', to: '2026-08-06' }, NOW)!
    expect(r.fromMs).toBe(at('2026-07-20T00:00:00'))
    // The whole of the 6th. Ending at its midnight would drop that day's sessions.
    expect(r.toMs).toBe(at('2026-08-06T23:59:59.999'))
  })

  it('a single-day custom range is that whole day', () => {
    const r = resolveRange('custom', { from: '2026-08-06', to: '2026-08-06' }, NOW)!
    expect(r.toMs - r.fromMs).toBeCloseTo(86_400_000 - 1, -2)
    expect(rangeDays(r)).toBe(1)
  })

  it('swaps a reversed range instead of showing nothing', () => {
    // Typing the end date first is a slip, not a request for an empty chart — and an empty
    // chart gives the learner no way to work out what they did wrong.
    const forward = resolveRange('custom', { from: '2026-07-20', to: '2026-08-06' }, NOW)!
    const reversed = resolveRange('custom', { from: '2026-08-06', to: '2026-07-20' }, NOW)!
    expect(reversed).toEqual(forward)
  })

  it('returns null while a custom field is still empty', () => {
    // Mid-typing. The caller keeps the previous window rather than blanking every chart on
    // the page between two keystrokes.
    expect(resolveRange('custom', { from: '2026-08-01', to: '' }, NOW)).toBeNull()
    expect(resolveRange('custom', null, NOW)).toBeNull()
    expect(resolveRange('custom', { from: 'nonsense', to: '2026-08-01' }, NOW)).toBeNull()
  })

  it('agrees with the old day counts for every preset', () => {
    // The presets are the same windows they always were; only their expression changed. If
    // this drifts, existing screens quietly start reporting a different span.
    for (const p of ['1d', '1w', '1m', '3m', '6m', '1y', '2y', '5y'] as const) {
      expect(rangeDays(resolveRange(p, null, NOW)!), p).toBe(periodToDays(p))
    }
  })
})

describe('toDateKey', () => {
  it('is local, not UTC', () => {
    // The charts group by local day. Using an ISO/UTC key puts late-evening study on
    // tomorrow for every learner east of Greenwich — which is all of the Korean ones.
    expect(toDateKey(new Date('2026-08-11T23:30:00'))).toBe('2026-08-11')
    expect(toDateKey(new Date('2026-01-05T00:10:00'))).toBe('2026-01-05')
  })
})
