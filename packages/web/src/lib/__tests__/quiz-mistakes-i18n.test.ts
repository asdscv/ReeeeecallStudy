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

    it('tells the learner what grading and retaking cost', () => {
      const tf = tr()
      // The billing is simple on purpose; the TELLING has to reach every language, or a Thai
      // learner taps 채점 not knowing whether it is free.
      expect(tf('pricing.gradeCost', { amount: '$0.10' })).toContain('$0.10')
      for (const key of ['pricing.retakeMcq', 'pricing.retakeWritten'] as const) {
        expect(tf(key)).not.toBe(key)
        // Not a character-count floor. This was `> 5` and zh failed it on "免费批改" — four
        // characters saying exactly what the English says in thirteen. A length bound on
        // translated text is a Latin-alphabet assumption.
        expect(tf(key).trim()).not.toBe('')
      }
      // The two retake notes must not be the same sentence: multiple choice costs nothing
      // because no model is called, written answers are charged per sitting.
      expect(tf('pricing.retakeMcq')).not.toBe(tf('pricing.retakeWritten'))
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
      'pricing.retakeWritten', 'error.QUIZ_DIFFICULTY_UNAVAILABLE'] as const) {
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

/**
 * The AI history and the AI badges, in every language.
 *
 * 기록 read study sessions and nothing else, and 업적 had 57 definitions about card study and
 * none about the part of the app that costs money. Both now say something, and both have to say
 * it in all eight.
 */
describe.each(['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const)('%s — AI 기록/업적', (lng) => {
  const quiz = () => t('web', lng)
  const common = () => {
    const i18n = createInstance()
    void i18n.init({
      lng,
      resources: { [lng]: { common: JSON.parse(readFileSync(
        resolve(__dirname, `../../../public/locales/${lng}/common.json`), 'utf-8')) } },
      ns: ['common'], defaultNS: 'common', initImmediate: false,
      interpolation: { escapeValue: false },
    })
    return i18n.getFixedT(lng, 'common')
  }

  it('names every AI job kind', () => {
    const tf = quiz()
    // The list renders whatever `job_kind`/`quiz_action` the server sends. A missing key here
    // shows the learner a raw enum like `image_deck`.
    for (const kind of ['cards', 'deck', 'template', 'image', 'image_deck', 'remediation', 'quiz',
      'generate_mcq', 'generate_short', 'generate_essay', 'grade_short', 'grade_essay',
      'quiz_answer_key'] as const) {
      const out = tf(`activity.job.${kind}`)
      expect(out, kind).not.toBe(`activity.job.${kind}`)
      expect(out.trim(), kind).not.toBe('')
    }
  })

  it('titles the section and prices a job', () => {
    const tf = quiz()
    expect(tf('activity.title')).not.toBe('activity.title')
    const line = tf('activity.quiz', { title: 'X', n: 3 })
    expect(line).toContain('X')
    expect(line).toContain('3')
    // "무료" is information, not an absence — it has to exist as a word.
    expect(tf('activity.free')).not.toBe('activity.free')
    expect(tf('activity.refunded')).not.toBe('activity.refunded')
  })

  it('names the AI achievement category and its badges', () => {
    const tf = common()
    expect(tf('achievements.category.ai')).not.toBe('achievements.category.ai')
    for (const id of ['perfect_quiz', 'comeback', 'quizzes_1', 'ai_cards_10', 'graded_1'] as const) {
      expect(tf(`achievements.badge.${id}`), id).not.toBe(`achievements.badge.${id}`)
    }
    // The "next goal" rows read from `goals.<category>`, and three categories are new.
    for (const cat of ['quizzes', 'ai_cards', 'graded'] as const) {
      expect(tf(`goals.${cat}`), cat).not.toBe(`goals.${cat}`)
    }
  })
})

/**
 * Every achievement in the database has a name, in every language.
 *
 * `achievement_definitions` holds 62 rows; the bundles had names for 25 of them. The rest fell
 * through `defaultValue: id.replace(/_/g, ' ')` and shipped as "decks 1", "time 1800" and
 * "market acquire 5" — identically in all eight languages, English included, because a raw id
 * is not English either.
 *
 * The list is the production table, read from `achievement_definitions` and pinned here: a test
 * cannot reach the database, and a badge added there without a name is exactly the failure this
 * is for. Adding a row means adding a line here — which is the point, not an inconvenience.
 */
const ACHIEVEMENT_IDS = [
  'ai_cards_10', 'ai_cards_50', 'cards_10', 'cards_100', 'cards_1000', 'cards_10000',
  'cards_2000', 'cards_25000', 'cards_50', 'cards_500', 'cards_5000', 'cards_50000',
  'comeback', 'decks_1', 'decks_10', 'decks_20', 'decks_5', 'decks_50',
  'early_bird', 'first_deck', 'first_review', 'first_share', 'graded_1', 'market_acquire_10',
  'market_acquire_25', 'market_acquire_5', 'mastery_10', 'mastery_100', 'mastery_1000', 'mastery_50',
  'mastery_500', 'night_owl', 'perfect_session', 'quizzes_1', 'quizzes_5', 'reviews_10',
  'reviews_5', 'sessions_1', 'sessions_10', 'sessions_100', 'sessions_1000', 'sessions_200',
  'sessions_50', 'sessions_500', 'shares_1', 'shares_10', 'shares_5', 'streak_100',
  'streak_14', 'streak_180', 'streak_3', 'streak_30', 'streak_365', 'streak_60',
  'streak_7', 'time_1800', 'time_18000', 'time_300', 'time_60', 'time_600',
  'time_6000', 'weekend_warrior',
] as const

// Both copies. Mobile keeps its own bundle AND its own Intl-free `number` formatter, so a name
// that renders on web can still come out wrong on a phone.
const COMMON_BUNDLES = {
  web: (lng: string) => resolve(__dirname, `../../../public/locales/${lng}/common.json`),
  mobile: (lng: string) => resolve(__dirname, `../../../../mobile/src/i18n/locales/${lng}/common.json`),
} as const

describe.each(
  (['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const).flatMap(
    (lng) => (['web', 'mobile'] as const).map((platform) => [lng, platform] as const)),
)('%s/%s — 업적 이름', (lng, platform) => {
  const common = () => {
    const i18n = createInstance()
    void i18n.init({
      lng,
      resources: { [lng]: { common: JSON.parse(readFileSync(COMMON_BUNDLES[platform](lng), 'utf-8')) } },
      ns: ['common'], defaultNS: 'common', initImmediate: false,
      interpolation: { escapeValue: false },
    })
    return i18n.getFixedT(lng, 'common')
  }

  it('names every badge, with its number in it', () => {
    const tf = common()
    for (const id of ACHIEVEMENT_IDS) {
      const name = tf(`achievements.badge.${id}`, { n: 1234 })
      expect(name, id).not.toBe(`achievements.badge.${id}`)
      expect(name.trim(), id).not.toBe('')
      // No leftover placeholder: `n` is a plain variable precisely so i18next's plural
      // selection cannot swallow the lookup and leave `{{n, number}}` on the screen.
      expect(name, id).not.toContain('{{')
    }
  })

  it('groups the thousands in a badge name the way the language does', () => {
    const tf = common()
    // 25,000 cards is the largest rung. On mobile this goes through the Intl-free formatter,
    // which is why the assertion is "not the bare digits" rather than a specific separator.
    const name = tf('achievements.badge.cards_25000', { n: 25000 })
    expect(name).toMatch(/25[.,\u00a0\u202f ]?000/)
  })
})


/**
 * No Hangul in a bundle that is not Korean.
 *
 * The English delete confirmation read "…and their 오답 노트 entries go with it" — the Korean
 * name for the mistake note, left in the sentence that tells someone their answers are about to
 * be destroyed. A key can be present, translated-looking, and still be half Korean; nothing else
 * in the suite would notice.
 *
 * Scoped to `quiz.json` on purpose. A sweep of all sixteen bundles finds Hangul in exactly two
 * other places and both are correct: `settings.language.ko` / `marketplace.learningLanguage.ko`
 * are "한국어", which is what Korean is called in a language picker in every language, and the
 * guide's example card is `'apple = 사과'`. A repo-wide version of this rule would have to
 * whitelist them, and a whitelist is where the next real leak would hide.
 */
describe.each((['en', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const).flatMap(
  (lng) => (['web', 'mobile'] as const).map((platform) => [lng, platform] as const)),
)('%s/%s — 한글 유출', (lng, platform) => {
  it('has no Hangul left in it', () => {
    const bundle = JSON.parse(readFileSync(PLATFORMS[platform](lng), 'utf-8')) as Record<string, unknown>
    // Hangul syllables and jamo. Japanese and Chinese share Han characters with nothing here, so
    // this only ever fires on genuinely Korean text.
    const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/
    const leaks: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (HANGUL.test(node)) leaks.push(`${path}: ${node.slice(0, 60)}`)
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
      }
    }
    walk(bundle, '')
    expect(leaks).toEqual([])
  })
})
