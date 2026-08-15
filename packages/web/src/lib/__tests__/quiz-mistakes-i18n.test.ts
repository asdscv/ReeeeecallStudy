/**
 * The 오답 노트 and the controls beside it, in every language the app ships.
 *
 * `translation-keys.test.ts` proves the KEYS line up across locales. That is not the same claim:
 * a key can be present, spelled right, and still render wrong, because these strings are the ones
 * carrying interpolation. `{{cards, number}}`, `{{decks, number}}` and `{{weight, number}}` go
 * through i18next's formatter, and `{{count}}` is RESERVED by i18next for plural selection — a
 * name collision there demands `_one`/`_other` in all sixteen files or the string silently falls
 * back. That is why they are `cards` and `decks`.
 *
 * So this renders each string through a real i18next instance, once per locale, and asserts the
 * numbers actually land in the output. Cheap, deterministic, and it runs in CI — unlike driving
 * eight languages through a browser, which the app does not even allow: it applies the account's
 * stored language and ignores `?lng=`.
 *
 * Mobile is checked from the same test because it has its own copy of every locale file AND its
 * own Intl-free `number` formatter — Hermes ships without ICU, so i18next's built-in one returns
 * the raw value there. A string that renders on web can still be wrong on a phone.
 */
import { describe, it, expect } from 'vitest'
import { createInstance } from 'i18next'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCALES = ['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const

const PLATFORMS = {
  web: (lng: string) => resolve(__dirname, `../../../public/locales/${lng}/quiz.json`),
  mobile: (lng: string) => resolve(__dirname, `../../../../mobile/src/i18n/locales/${lng}/quiz.json`),
} as const

function t(platform: keyof typeof PLATFORMS, lng: string) {
  const i18n = createInstance()
  void i18n.init({
    lng,
    resources: { [lng]: { quiz: JSON.parse(readFileSync(PLATFORMS[platform](lng), 'utf-8')) } },
    ns: ['quiz'],
    defaultNS: 'quiz',
    initImmediate: false,
    interpolation: { escapeValue: false },
  })
  return i18n.getFixedT(lng, 'quiz')
}

describe.each(Object.keys(PLATFORMS) as (keyof typeof PLATFORMS)[])('%s', (platform) => {
  describe.each(LOCALES)('%s', (lng) => {
    const tr = () => t(platform, lng)

    it('says how many cards and how many decks, with both numbers', () => {
      const out = tr()('mistakes.summary', { cards: 9, decks: 2 })
      expect(out).toContain('9')
      expect(out).toContain('2')
      // The key itself coming back means the lookup missed entirely.
      expect(out).not.toBe('mistakes.summary')
    })

    it('offers the study action with its count', () => {
      const out = tr()('mistakes.studyAgain', { cards: 7 })
      expect(out).toContain('7')
      expect(out).not.toBe('mistakes.studyAgain')
    })

    it('renders the rest of the panel', () => {
      const tf = tr()
      for (const key of ['mistakes.title', 'mistakes.expand', 'mistakes.collapse'] as const) {
        const out = tf(key)
        expect(out).not.toBe(key)
        expect(out.trim()).not.toBe('')
      }
      expect(tf('mistakes.youWrote', { answer: 'harbour' })).toContain('harbour')
      expect(tf('mistakes.andMore', { cards: 4 })).toContain('4')
    })

    it('names the remove control and the daily check', () => {
      const tf = tr()
      // `__daily_check__` is a sentinel the RPC matches on, and it used to reach the screen
      // verbatim. Every language needs a name for it, not just the two we look at.
      for (const key of ['home.remove', 'home.dailyCheckTitle'] as const) {
        const out = tf(key)
        expect(out).not.toBe(key)
        expect(out).not.toContain('__daily_check__')
      }
    })

    it('states what an essay criterion was worth', () => {
      const out = tr()('level.weight', { weight: 60 })
      expect(out).toContain('60')
      expect(out).not.toBe('level.weight')
    })

    it('explains a difficulty a question type has no guidance for', () => {
      // P0013 used to arrive as UNKNOWN — "문제가 생겼어요" — so the one action that fixes it
      // was the one thing not said, in any language.
      const out = tr()('error.QUIZ_DIFFICULTY_UNAVAILABLE')
      expect(out).not.toBe('error.QUIZ_DIFFICULTY_UNAVAILABLE')
      expect(out.length).toBeGreaterThan(10)
    })

    it('dates a set without Intl', () => {
      const tf = tr()
      // Hermes has no ICU, so `toLocaleDateString` returns the same English on every phone. The
      // PARTS come from `calendarParts` and the ORDER comes from these strings — which is why
      // every locale has to carry both shapes.
      const short = tf('history.dateThisYear', { m: 8, d: 15 })
      expect(short).toContain('8')
      expect(short).toContain('15')
      const full = tf('history.dateWithYear', { y: 2025, m: 8, d: 15 })
      expect(full).toContain('2025')
      expect(full).toContain('15')
    })

    it('says when a set was made and how often it has been taken', () => {
      const tf = tr()
      expect(tf('history.created', { date: 'X' })).toContain('X')
      const taken = tf('history.taken', { runs: 3, date: 'X' })
      expect(taken).toContain('3')
      expect(taken).toContain('X')
      const attempt = tf('history.attempt', { n: 2, date: 'X' })
      expect(attempt).toContain('2')
      for (const key of ['history.never', 'history.show', 'history.hide', 'history.inProgress'] as const) {
        expect(tf(key)).not.toBe(key)
      }
    })

    it('counts generation batches', () => {
      const out = tr()('setup.generatingBatch', { done: 2, total: 5 })
      expect(out).toContain('2')
      expect(out).toContain('5')
    })
  })
})

describe('the translations are actually different from each other', () => {
  it('does not ship English eight times', () => {
    // The failure mode a key-presence check cannot see: a locale file that has every key and
    // every value copied from en.
    for (const key of ['mistakes.title', 'home.remove', 'history.never',
      'error.QUIZ_DIFFICULTY_UNAVAILABLE'] as const) {
      const rendered = LOCALES.map((lng) => t('web', lng)(key))
      expect(new Set(rendered).size).toBeGreaterThan(5)
    }
  })

  it('keeps web and mobile saying the same thing in each language', () => {
    // Two copies of every locale file. They drift silently, and the learner meets both.
    for (const lng of LOCALES) {
      for (const key of ['mistakes.title', 'mistakes.expand', 'home.remove'] as const) {
        expect(t('mobile', lng)(key), `${lng}/${key}`).toBe(t('web', lng)(key))
      }
    }
  })
})
