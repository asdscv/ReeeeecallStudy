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

const LANGUAGE_NAMES = {
  en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
  vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', es: 'Spanish',
}

export const ARTICLE_FORMATS = {
  guide: 'A step-by-step how-to: the searcher wants to do something — study for an exam, memorize a list, use a method.',
  comparison: 'A side-by-side comparison: the searcher is weighing two or more options — methods, exams, levels, schedules (e.g. "X vs Y", "which is better").',
  explainer: 'An explanation: the searcher wants to understand what something is, what it means, or why it works.',
}

const SITE = {
  name: 'ReeeeecallStudy',
  what_it_is: 'A flashcard app with spaced repetition for memorizing: exam preparation (TOEIC, IELTS, TOEFL, JLPT, HSK, TOPIK, SAT, 수능, professional certifications), vocabulary and language learning. Its website publishes free study guides.',
}

export function normalizeQuery(q) {
  return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Queries Google shows us for that nobody clicks, minus ones we already wrote a page for. */
export function findOpportunities(rows, alreadyTargeted, opts = KEYWORD_PLANNER) {
  const seen = new Set(alreadyTargeted.map(normalizeQuery))
  return rows
    .filter((r) => normalizeQuery(r.query) !== '')
    .filter((r) => r.impressions >= opts.minImpressions && r.clicks <= opts.maxClicks && r.position >= opts.minPosition)
    .filter((r) => !seen.has(normalizeQuery(r.query)))
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

/** Combine the numbers with Jev's judgments: impressions × fit, after the hard exclusions. */
export function chooseKeyword(candidates, answers, opts = KEYWORD_PLANNER) {
  const judged = candidates.map((c, i) => {
    const fit = noulOf(answers[`fit_${i}`]) ?? 0
    const brand = noulOf(answers[`brand_${i}`]) ?? 1
    const locale = choiceOf(answers[`lang_${i}`])
    const format = choiceOf(answers[`format_${i}`])
    return { ...c, fit, brand, locale, format, score: c.impressions * fit }
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
