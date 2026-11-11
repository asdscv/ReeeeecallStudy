// Daily keyword planner: pick today's article from what Google already shows us for.
//
// Search Console lists queries where the site gets impressions but no clicks — usually because
// the impression lands on a page ranked ~50 that doesn't really answer the query. Writing one page
// that does is the cheapest traffic we can earn. Code finds those queries by the numbers; Jev judges
// what numbers can't (is this a learner's question, does it name another product, what language,
// what kind of page answers it); code combines the two and picks one.

import { callJev, JEV_MODEL } from '../supabase/functions/_shared/jev-client.ts'
import { KEYWORD_PLANNER } from './config.js'
import { GENERATED_LOCALES } from './locale-policy.js'
import { getGscConfig, fetchSearchQueries } from './search-console.js'
import { slugify } from './topic-generator.js'
import { info } from './logger.js'
import { DECK_LEVELS, formatDeckFamily } from '../packages/shared/lib/official-deck-family.ts'

const LANGUAGE_NAMES = {
  en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
  vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', es: 'Spanish',
}

export const ARTICLE_FORMATS = {
  guide: 'A step-by-step how-to: the searcher wants to do something — study for an exam, memorize a list, use a method.',
  comparison: 'A side-by-side comparison: the searcher is weighing two or more options — methods, exams, levels, schedules (e.g. "X vs Y", "which is better").',
  explainer: 'An explanation: the searcher wants to understand what something is, what it means, or why it works.',
}

// Our free official decks are all English vocabulary (plus Korean→English conversation).
export const DECK_TYPES = {
  toeic: 'TOEIC vocabulary — the searcher is preparing for TOEIC and wants words to memorize.',
  ielts: 'IELTS vocabulary — the searcher is preparing for IELTS and wants words or phrases to memorize.',
  toefl: 'TOEFL vocabulary — the searcher is preparing for TOEFL and wants words to memorize.',
  conversation: 'Everyday spoken English expressions (travel, work, daily life) to memorize.',
  general: 'General English vocabulary by level (beginner / intermediate / advanced), not tied to an exam.',
  none: 'A ready-made English vocabulary list would not directly give this searcher what they want — e.g. grammar rules, essay structure, test strategy, or a subject other than English vocabulary.',
}

// A page whose answer is one of our decks can turn a reader into a learner in one tap.
export const DECK_BOOST = 2

const SITE = {
  name: 'ReeeeecallStudy',
  what_it_is: 'A flashcard app with spaced repetition for memorizing: exam preparation (TOEIC, IELTS, TOEFL, JLPT, HSK, TOPIK, SAT, 수능, professional certifications), vocabulary and language learning. Its website publishes free study guides.',
}

export function normalizeQuery(q) {
  return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// "toeic part6" and "toeic part 6", "n2문법" and "n2 문법" are one search need — and one page.
export function queryKey(q) {
  return normalizeQuery(q).replace(/\s+/g, '')
}

/** Queries Google shows us for that nobody clicks, minus ones we already wrote a page for. */
export function findOpportunities(rows, alreadyTargeted, opts = KEYWORD_PLANNER) {
  // Spacing variants become one candidate: impressions add up, clicks add up (any click
  // disqualifies), and the best-ranked spelling is the one the page is written for.
  const merged = new Map()
  for (const r of rows) {
    const key = queryKey(r.query)
    if (!key) continue
    const prev = merged.get(key)
    if (!prev) { merged.set(key, { ...r }); continue }
    const best = r.position < prev.position ? r : prev
    merged.set(key, {
      ...best,
      impressions: prev.impressions + r.impressions,
      clicks: prev.clicks + r.clicks,
      position: Math.min(prev.position, r.position),
    })
  }
  const seen = new Set(alreadyTargeted.map(queryKey))
  return [...merged.values()]
    .filter((r) => r.impressions >= opts.minImpressions && r.clicks <= opts.maxClicks && r.position >= opts.minPosition)
    .filter((r) => !seen.has(queryKey(r.query)))
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, opts.maxCandidates)
}

export function buildKeywordJevRequest(candidates) {
  const languageCriteria = {}
  for (const l of GENERATED_LOCALES) languageCriteria[l] = LANGUAGE_NAMES[l] || l
  languageCriteria.other = 'Any other language, or a mix with no clear main language.'

  const questions = {}
  candidates.forEach((_, i) => {
    const q = `\`candidates[${i}].query\``
    questions[`fit_${i}`] = {
      type: 'noul',
      instructions: `Would a person who typed ${q} into Google be well served by a practical study guide published by \`site\`? Yes means they are studying — preparing for an exam, learning a language or vocabulary, or memorizing material — and a guide can genuinely answer the query.`,
      criteria: {
        true: 'A learner\'s question that a study guide can answer.',
        false: 'The searcher wants something else: a specific product or download, news, entertainment, a person, homework answers to copy, or a topic unrelated to studying and memorizing.',
      },
    }
    questions[`brand_${i}`] = {
      type: 'noul',
      instructions: `Does ${q} name a specific app, website, company or product other than \`site.name\`?`,
    }
    questions[`lang_${i}`] = {
      type: 'choice',
      instructions: `Which language is ${q} written in?`,
      criteria: languageCriteria,
    }
    questions[`deck_${i}`] = {
      type: 'choice',
      instructions: `Which ready-made flashcard deck would directly give a person who typed ${q} what they are looking for?`,
      criteria: { ...DECK_TYPES },
    }
    questions[`format_${i}`] = {
      type: 'choice',
      instructions: `What kind of page would best answer ${q}?`,
      criteria: { ...ARTICLE_FORMATS },
    }
  })

  return {
    model: JEV_MODEL,
    state: { site: SITE, candidates: candidates.map((c) => ({ query: c.query })) },
    questions,
  }
}

function noulOf(answer) {
  return answer && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null
}

function choiceOf(answer) {
  return answer && answer.type === 'choice' && typeof answer.choice === 'string' ? answer.choice : null
}

function nearestLevel(levels, numbers, fallback) {
  if (numbers.length === 0) return fallback
  const n = numbers[0]
  return levels.reduce((best, l) => (Math.abs(Number(l) - n) < Math.abs(Number(best) - n) ? l : best), levels[0])
}

/** Which deck family a query points at, given the deck type Jev chose. Levels come from the query's own numbers. */
const EXAM_NAMES = { toeic: /toeic|토익/, ielts: /ielts|아이엘츠/, toefl: /toefl|토플/ }

export function familyForQuery(deckType, query) {
  const q = normalizeQuery(query)
  // An exam named in the text outranks the model: a TOEFL page never leads to a TOEIC deck.
  const named = Object.keys(EXAM_NAMES).filter((exam) => EXAM_NAMES[exam].test(q))
  if (named.length > 0 && !named.includes(deckType)) return null
  const nums = (min, max) => (q.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n >= min && n <= max)
  switch (deckType) {
    case 'toeic': return { category: 'toeic', level: nearestLevel(DECK_LEVELS.toeic, nums(300, 990), '800') }
    case 'ielts': return { category: 'ielts', level: nearestLevel(DECK_LEVELS.ielts, nums(4, 9), '6.5') }
    case 'toefl': return { category: 'toefl', level: nearestLevel(DECK_LEVELS.toefl, nums(40, 120), '100') }
    case 'conversation': {
      const theme = /여행|travel|trip|airport|hotel/.test(q) ? '여행'
        : /회사|직장|비즈니스|business|office|work|meeting/.test(q) ? '회사'
          : /시사|뉴스|news/.test(q) ? '시사'
            : /학교|수업|공부|school|class|study/.test(q) ? '학습' : '일상'
      return { category: 'conversation', level: theme }
    }
    case 'general': {
      const category = /초급|기초|beginner|basic|elementary/.test(q) ? 'beginner'
        : /고급|advanced/.test(q) ? 'advanced' : 'intermediate'
      return { category, level: 'batch-1' }
    }
    default: return null
  }
}

/** Combine the numbers with Jev's judgments: impressions × fit, after the hard exclusions. */
export function chooseKeyword(candidates, answers, opts = KEYWORD_PLANNER) {
  const judged = candidates.map((c, i) => {
    const fit = noulOf(answers[`fit_${i}`]) ?? 0
    const brand = noulOf(answers[`brand_${i}`]) ?? 1
    const locale = choiceOf(answers[`lang_${i}`])
    const format = choiceOf(answers[`format_${i}`])
    const family = familyForQuery(choiceOf(answers[`deck_${i}`]), c.query)
    const deckFamily = family ? formatDeckFamily(family) : null
    return { ...c, fit, brand, locale, format, deckFamily, score: c.impressions * fit * (deckFamily ? DECK_BOOST : 1) }
  })
  const eligible = judged
    .filter((j) => j.fit >= opts.minFit)
    .filter((j) => j.brand < opts.maxBrand)
    .filter((j) => GENERATED_LOCALES.includes(j.locale))
    .filter((j) => Object.hasOwn(ARTICLE_FORMATS, j.format))
    // At one or two impressions per query, ties are common: prefer the page Google already ranks higher.
    .sort((a, b) => b.score - a.score || a.position - b.position)
  return { pick: eligible[0] || null, judged }
}

export function topicFromKeyword(pick) {
  return {
    id: slugify(pick.query).replace(/^-+|-+$/g, '') || `search-query-${Date.now()}`,
    category: 'exam preparation and studying',
    titleHint: pick.query,
    keywords: [pick.query],
    tags: [],
    audience: 'people who typed this exact query into Google',
    targetQuery: pick.query,
    queryLocale: pick.locale,
    format: pick.format,
    deckFamily: pick.deckFamily || null,
  }
}

// When Search Console has nothing to harvest, write the page for an obvious query whose answer is
// one of our official decks. Round-robin across exams so consecutive days are not the same topic.
export const DECK_GUIDES = [
  { family: 'toeic:800', query: '토익 800점 단어', queryLocale: 'ko' },
  { family: 'ielts:6.5', query: 'ielts band 6.5 vocabulary list', queryLocale: 'en' },
  { family: 'toefl:100', query: 'toefl 100 vocabulary list', queryLocale: 'en' },
  { family: 'conversation:여행', query: '여행 영어 회화 표현', queryLocale: 'ko' },
  { family: 'toeic:900', query: '토익 900점 단어', queryLocale: 'ko' },
  { family: 'ielts:7.0', query: 'ielts band 7 vocabulary list', queryLocale: 'en' },
  { family: 'toefl:110', query: 'toefl 110 vocabulary list', queryLocale: 'en' },
  { family: 'conversation:회사', query: '비즈니스 영어 회화 표현', queryLocale: 'ko' },
  { family: 'toeic:700', query: '토익 700점 단어', queryLocale: 'ko' },
  { family: 'ielts:6.0', query: 'ielts band 6 vocabulary list', queryLocale: 'en' },
  { family: 'toefl:80', query: 'toefl 80 vocabulary list', queryLocale: 'en' },
  { family: 'conversation:일상', query: '일상 영어 회화 표현', queryLocale: 'ko' },
  { family: 'toeic:600', query: '토익 600점 단어', queryLocale: 'ko' },
  { family: 'ielts:5.5', query: 'ielts band 5.5 vocabulary list', queryLocale: 'en' },
  { family: 'toefl:120', query: 'toefl 120 vocabulary list', queryLocale: 'en' },
  { family: 'beginner:batch-1', query: '기초 영어 단어', queryLocale: 'ko' },
  { family: 'toeic:990', query: '토익 990 고득점 단어', queryLocale: 'ko' },
  { family: 'ielts:5.0', query: 'ielts band 5 vocabulary list', queryLocale: 'en' },
  { family: 'toefl:60', query: 'toefl 60 vocabulary list', queryLocale: 'en' },
  { family: 'intermediate:batch-1', query: '중급 영어 단어', queryLocale: 'ko' },
  { family: 'conversation:시사', query: '시사 영어 표현', queryLocale: 'ko' },
  { family: 'advanced:batch-1', query: '고급 영어 단어', queryLocale: 'ko' },
  { family: 'conversation:학습', query: '영어 수업 회화 표현', queryLocale: 'ko' },
]

/** The next deck guide not yet written, or null once every family has its page. */
export async function planDeckTopic(db) {
  const targeted = new Set((await db.getTargetedQueries()).map(queryKey))
  const next = DECK_GUIDES.find((g) => !targeted.has(queryKey(g.query)))
  if (!next) return null
  return {
    ...topicFromKeyword({ query: next.query, locale: next.queryLocale, format: 'guide', deckFamily: next.family }),
    category: 'English vocabulary for exams and conversation',
  }
}

/**
 * Today's keyword topic, or null when the planner is not configured or nothing qualifies
 * (the pipeline then falls back to AI-generated topics). Throws on GSC/Jev failures.
 */
export async function planKeywordTopic(env, db, { now = new Date() } = {}) {
  const gsc = getGscConfig(env)
  if (!gsc.serviceAccount) {
    info('Keyword planner skipped: GSC_SERVICE_ACCOUNT_JSON not set')
    return null
  }
  if (!env.TYPESAFE_API_KEY) {
    info('Keyword planner skipped: TYPESAFE_API_KEY not set')
    return null
  }

  const [rows, targeted] = await Promise.all([
    fetchSearchQueries(gsc, { now, days: KEYWORD_PLANNER.windowDays }),
    db.getTargetedQueries(),
  ])
  const candidates = findOpportunities(rows, targeted)
  info('Keyword planner: opportunities', { queries: rows.length, alreadyTargeted: targeted.length, candidates: candidates.length })
  if (candidates.length === 0) return null

  const res = await callJev(buildKeywordJevRequest(candidates), { apiKey: env.TYPESAFE_API_KEY })
  const { pick, judged } = chooseKeyword(candidates, res.answers)
  info('Keyword planner: judged', {
    model: res.model,
    top: [...judged].sort((a, b) => b.score - a.score).slice(0, 5).map((j) => ({
      query: j.query, impressions: j.impressions, position: Math.round(j.position),
      fit: Number(j.fit.toFixed(2)), brand: Number(j.brand.toFixed(2)), locale: j.locale, format: j.format,
    })),
    picked: pick?.query ?? null,
  })
  return pick ? topicFromKeyword(pick) : null
}
