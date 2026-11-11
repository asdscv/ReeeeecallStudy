import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger.js', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../search-console.js', () => ({
  getGscConfig: vi.fn(),
  fetchSearchQueries: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/jev-client.ts', () => ({
  JEV_MODEL: 'jev-latest',
  callJev: vi.fn(),
}))

import {
  findOpportunities, buildKeywordJevRequest, chooseKeyword, topicFromKeyword, planKeywordTopic, normalizeQuery,
} from '../keyword-planner.js'
import { getGscConfig, fetchSearchQueries } from '../search-console.js'
import { callJev } from '../../supabase/functions/_shared/jev-client.ts'
import { buildPrompt } from '../prompt-builder.js'

const row = (query, impressions, clicks = 0, position = 40) => ({ query, impressions, clicks, ctr: 0, position })

function answersFor(perQuery) {
  const answers = {}
  perQuery.forEach((a, i) => {
    answers[`fit_${i}`] = { type: 'noul', noul: a.fit }
    answers[`brand_${i}`] = { type: 'noul', noul: a.brand ?? 0.02 }
    answers[`lang_${i}`] = { type: 'choice', choice: a.lang ?? 'en', probabilities: {}, confidence: 0.9 }
    answers[`format_${i}`] = { type: 'choice', choice: a.format ?? 'guide', probabilities: {}, confidence: 0.9 }
  })
  return answers
}

describe('findOpportunities', () => {
  it('keeps only impressions-without-clicks below page-one top, highest impressions first', () => {
    const out = findOpportunities([
      row('toeic part 5 tips', 120),
      row('ielts band 7 vocabulary', 300),
      row('already clicked', 500, 3),
      row('ranks third already', 400, 0, 3),
    ], [])
    expect(out.map((r) => r.query)).toEqual(['ielts band 7 vocabulary', 'toeic part 5 tips'])
  })

  it('counts a single impression at this site\'s scale, closer-to-page-one first on ties', () => {
    const out = findOpportunities([row('jlpt n2 문법', 1, 0, 67), row('usmle 준비', 1, 0, 19), row('n2 독해', 3, 0, 43)], [])
    expect(out.map((r) => r.query)).toEqual(['n2 독해', 'usmle 준비', 'jlpt n2 문법'])
  })

  it('applies a stricter impressions floor when one is configured', () => {
    const out = findOpportunities([row('a', 5), row('b', 30)], [], { minImpressions: 20, maxClicks: 0, minPosition: 8, maxCandidates: 25 })
    expect(out.map((r) => r.query)).toEqual(['b'])
  })

  it('skips queries we already wrote a page for, ignoring case and spacing', () => {
    const out = findOpportunities([row('JLPT N3  kanji list', 90), row('hsk 4 words', 80)], ['jlpt n3 kanji list'])
    expect(out.map((r) => r.query)).toEqual(['hsk 4 words'])
  })

  it('caps the shortlist at maxCandidates', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`query ${i}`, 100 + i))
    expect(findOpportunities(rows, [])).toHaveLength(25)
  })
})

describe('buildKeywordJevRequest', () => {
  it('asks four questions per candidate over shared state', () => {
    const req = buildKeywordJevRequest([row('a', 50), row('b', 40)])
    expect(Object.keys(req.questions).sort()).toEqual(
      ['brand_0', 'brand_1', 'fit_0', 'fit_1', 'format_0', 'format_1', 'lang_0', 'lang_1'],
    )
    expect(req.state.candidates).toEqual([{ query: 'a' }, { query: 'b' }])
    expect(req.questions.fit_1.instructions).toContain('`candidates[1].query`')
    expect(Object.keys(req.questions.lang_0.criteria)).toEqual(['en', 'ko', 'other'])
  })
})

describe('chooseKeyword', () => {
  const candidates = [row('quizlet alternative', 900), row('best anime 2026', 800), row('toeic part 5 tips', 200), row('수능 영어 단어 외우는 법', 150)]

  it('drops competitor brands, off-topic and ungenerated languages, then ranks impressions x fit', () => {
    const { pick } = chooseKeyword(candidates, answersFor([
      { fit: 0.9, brand: 0.97 },
      { fit: 0.05 },
      { fit: 0.8 },
      { fit: 0.95, lang: 'ko' },
    ]))
    // 200 x 0.8 = 160 beats 150 x 0.95 = 142.5
    expect(pick.query).toBe('toeic part 5 tips')
  })

  it('returns no pick when nothing clears the fit bar', () => {
    const { pick } = chooseKeyword([row('x', 100)], answersFor([{ fit: 0.4 }]))
    expect(pick).toBeNull()
  })

  it('treats a missing answer as not eligible rather than guessing', () => {
    const { pick } = chooseKeyword([row('x', 100)], {})
    expect(pick).toBeNull()
  })

  it('breaks a score tie toward the better-ranked query', () => {
    const { pick } = chooseKeyword([row('far', 1, 0, 80), row('near', 1, 0, 19)], answersFor([{ fit: 0.9 }, { fit: 0.9 }]))
    expect(pick.query).toBe('near')
  })

  it('rejects a language the pipeline does not generate', () => {
    const { pick } = chooseKeyword([row('học từ vựng toeic', 100)], answersFor([{ fit: 0.9, lang: 'other' }]))
    expect(pick).toBeNull()
  })
})

describe('topicFromKeyword → prompt', () => {
  const topic = topicFromKeyword({ query: 'toeic part 5 tips', locale: 'en', format: 'comparison' })

  it('pins the exact query in the same-language edition', () => {
    const { user } = buildPrompt(topic, 'en')
    expect(user).toContain('"toeic part 5 tips" verbatim')
    expect(user).toContain('Never name or compare other apps')
  })

  it('asks the other-language edition for the natural local phrasing instead', () => {
    const { user } = buildPrompt(topic, 'ko')
    expect(user).not.toContain('verbatim')
    expect(user).toContain('a native speaker would actually type')
  })

  it('keeps the original query out of the other edition\'s subject and keywords', () => {
    const ko = topicFromKeyword({ query: 'jlpt n2 문법', locale: 'ko', format: 'guide' })
    const { user } = buildPrompt(ko, 'en')
    const assignment = user.split('## Search Query')[0]
    expect(assignment).not.toContain('Subtopic: jlpt n2 문법')
    expect(assignment).not.toContain('Keywords to incorporate: jlpt n2 문법')
    expect(user).toContain('Never copy words or script from the original query')
  })

  it('gives a mixed-script query a clean id', () => {
    expect(topicFromKeyword({ query: 'jlpt n2 문법', locale: 'ko', format: 'guide' }).id).toBe('jlpt-n2')
  })

  it('leaves AI-generated topics untouched', () => {
    const { user } = buildPrompt({ category: 'c', titleHint: 't', keywords: ['k'], tags: ['x'], audience: 'a' }, 'en')
    expect(user).not.toContain('Search Query This Page Must Answer')
  })
})

describe('planKeywordTopic', () => {
  const db = { getTargetedQueries: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    getGscConfig.mockReturnValue({ serviceAccount: { client_email: 'sa@x', private_key: 'k' }, siteUrl: 'sc-domain:x' })
  })

  it('is a no-op without Search Console credentials', async () => {
    getGscConfig.mockReturnValue({ serviceAccount: null, siteUrl: 'sc-domain:x' })
    expect(await planKeywordTopic({ TYPESAFE_API_KEY: 'k' }, db)).toBeNull()
    expect(fetchSearchQueries).not.toHaveBeenCalled()
  })

  it('is a no-op without a Jev key', async () => {
    expect(await planKeywordTopic({}, db)).toBeNull()
    expect(fetchSearchQueries).not.toHaveBeenCalled()
  })

  it('does not call Jev when no query qualifies', async () => {
    fetchSearchQueries.mockResolvedValue([row('clicked', 100, 4)])
    db.getTargetedQueries.mockResolvedValue([])
    expect(await planKeywordTopic({ TYPESAFE_API_KEY: 'k' }, db)).toBeNull()
    expect(callJev).not.toHaveBeenCalled()
  })

  it('returns a topic carrying the query, its language and format', async () => {
    fetchSearchQueries.mockResolvedValue([row('Toeic Part 5 Tips', 200)])
    db.getTargetedQueries.mockResolvedValue([])
    callJev.mockResolvedValue({ model: 'jev-1', answers: answersFor([{ fit: 0.9, format: 'guide' }]), usage: null })
    const topic = await planKeywordTopic({ TYPESAFE_API_KEY: 'k' }, db)
    expect(topic).toMatchObject({ targetQuery: 'Toeic Part 5 Tips', queryLocale: 'en', format: 'guide', id: 'toeic-part-5-tips' })
    expect(normalizeQuery(topic.targetQuery)).toBe('toeic part 5 tips')
  })
})
