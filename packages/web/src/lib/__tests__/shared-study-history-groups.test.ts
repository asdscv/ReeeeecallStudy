/**
 * "Invalid Date" — the mobile 학습 기록 header, in seven of the eight languages this app ships.
 *
 * `groupSessionsByDate` in `packages/shared` returned ONE string per group, the date written
 * out in the reader's language, and it was used for two incompatible jobs: as the Map key, and
 * as the heading. Mobile then took that heading and did `new Date(group.date)` to decide
 * whether to say 오늘/어제 — and `new Date('2026년 8월 12일')` is Invalid Date, which
 * `toLocaleDateString` renders as the literal text "Invalid Date". Only English escaped,
 * because `new Date('August 12, 2026')` happens to parse.
 *
 * The 오늘/어제 branch was dead in all eight anyway: it compared that localized sentence against
 * `toISOString().split('T')[0]`, so not even "August 12, 2026" ever equalled "2026-08-12".
 *
 * NOTE this is the SHARED copy, which only mobile imports. `packages/web/src/lib/study-history.ts`
 * is a separate duplicate with its own tests and is deliberately untouched — web renders
 * `group.date` straight into a heading and never parses it back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import i18next from 'i18next'
import {
  groupSessionsByDate, type SessionDateGroup,
} from '@reeeeecall/shared/lib/study-history'
import type { StudySession } from '@reeeeecall/shared/types/database'

/** The eight locales this app ships. The bug was invisible in exactly one of them. */
const LOCALES = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const

const session = (completedAt: string, id = completedAt): StudySession => ({
  id, deck_id: 'deck-1', completed_at: completedAt,
} as StudySession)

let originalLanguage: string

beforeEach(() => { originalLanguage = i18next.language })
afterEach(() => { i18next.changeLanguage(originalLanguage) })

/** A local `YYYY-MM-DD`, built the way the grouper builds its key. */
const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('a session date group', () => {
  it('carries a key that is a date, in every locale', () => {
    // The whole defect in one assertion: whatever language the heading is written in, the KEY
    // stays machine-readable. A consumer that compares it to a calendar day gets an answer.
    for (const locale of LOCALES) {
      i18next.changeLanguage(locale)
      const [group] = groupSessionsByDate([session('2026-08-12T09:30:00Z')])
      expect(group.key, locale).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // And it round-trips: this is precisely what mobile could not do before.
      expect(Number.isNaN(new Date(group.key).getTime()), locale).toBe(false)
    }
  })

  it('carries a label a person can read, in their own language', () => {
    i18next.changeLanguage('ko')
    const [ko] = groupSessionsByDate([session('2026-08-12T09:30:00Z')])
    i18next.changeLanguage('en')
    const [en] = groupSessionsByDate([session('2026-08-12T09:30:00Z')])

    expect(ko.label).not.toBe(en.label)
    // The thing that actually shipped to seven locales. Not a formatting nitpick — this was
    // the entire visible content of every header on the screen.
    for (const group of [ko, en]) expect(group.label).not.toContain('Invalid Date')
  })

  it('never renders "Invalid Date", in any of the eight', () => {
    for (const locale of LOCALES) {
      i18next.changeLanguage(locale)
      const [group] = groupSessionsByDate([session('2026-08-12T09:30:00Z')])
      expect(group.label, locale).not.toMatch(/invalid/i)
      expect(group.label.trim(), locale).not.toBe('')
    }
  })

  it('groups a day together and keeps the newest day first', () => {
    i18next.changeLanguage('ko')
    // Built in LOCAL time on purpose: a fixture written as `...T23:00:00Z` is a different
    // calendar day east of UTC, which is where this app's learners are. The grouping is by
    // local day, so the test has to speak local days too.
    const at = (dayOffset: number, hour: number) => {
      const d = new Date()
      d.setDate(d.getDate() - dayOffset)
      d.setHours(hour, 0, 0, 0)
      return d.toISOString()
    }
    const groups = groupSessionsByDate([
      session(at(2, 10), 'a'),
      session(at(0, 9), 'b'),
      session(at(0, 21), 'c'),
    ])
    expect(groups.map((g) => g.sessions.length)).toEqual([2, 1])
    expect(new Date(groups[0].key).getTime()).toBeGreaterThan(new Date(groups[1].key).getTime())
  })

  it('keys on the LOCAL day, not the UTC one', () => {
    // A session finished late in the evening in KST is already tomorrow in UTC. Keying on
    // `toISOString()` filed it under the wrong heading and made "오늘" wrong for anyone
    // studying after 9pm — which is most of them.
    const evening = new Date()
    evening.setHours(23, 30, 0, 0)
    const [group] = groupSessionsByDate([session(evening.toISOString())])
    expect(group.key).toBe(localKey(evening))
  })

  it('does not merge unrelated sessions under one broken heading', () => {
    // An unparseable timestamp used to key as NaN, so every bad row in the account collapsed
    // into a single group — one heading over sessions from different days.
    const groups: SessionDateGroup[] = groupSessionsByDate([
      session('not-a-date', 'x'),
      session('also-not-a-date', 'y'),
    ])
    expect(groups.length).toBe(2)
  })

  it('is empty for no sessions', () => {
    expect(groupSessionsByDate([])).toEqual([])
  })
})
