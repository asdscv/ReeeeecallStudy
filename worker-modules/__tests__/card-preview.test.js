import { describe, it, expect } from 'vitest'
import {
  renderSampleCardsHtml,
  buildSampleCardLearningResources,
} from '../seo/card-preview.js'

const wordSamples = [
  {
    field_values: {
      kind: 'word',
      front: 'ontology',
      back: '存在論',
      example_front: 'Ontology investigates the fundamental categories of being.',
      example_back: '存在論は存在の根本的なカテゴリーを探究する。',
    },
  },
  {
    field_values: {
      kind: 'word',
      front: 'teleological',
      back: '目的論的',
      example_front: 'The teleological argument infers design from nature.',
      example_back: '目的論的論証は自然の複雑さから設計を推論する。',
    },
  },
]

const phraseSamples = [
  {
    field_values: {
      kind: 'phrase',
      front: '요즘 물가가 미쳤어',
      back: 'Prices are insane these days.',
      alt: "Everything's so pricey now.",
      situation: '물가',
      note: 'cost of living = 생활비',
    },
  },
]

describe('renderSampleCardsHtml', () => {
  it('returns empty string for missing or empty input', () => {
    expect(renderSampleCardsHtml(null, 'en', 'X')).toBe('')
    expect(renderSampleCardsHtml(undefined, 'en', 'X')).toBe('')
    expect(renderSampleCardsHtml([], 'en', 'X')).toBe('')
  })

  it('renders word-card front/back/examples and includes the content as HTML', () => {
    const html = renderSampleCardsHtml(wordSamples, 'en', 'Advanced (EN→JA)')
    expect(html).toContain('Card preview')
    expect(html).toContain('ontology')
    expect(html).toContain('存在論')
    expect(html).toContain('Ontology investigates the fundamental categories')
    expect(html).toContain('存在論は存在の根本的なカテゴリーを探究する。')
    expect(html).toContain('teleological')
    expect(html).toContain('目的論的')
  })

  it('uses Korean labels when lang=ko', () => {
    const html = renderSampleCardsHtml(wordSamples, 'ko', 'Advanced')
    expect(html).toContain('카드 미리보기')
    expect(html).toContain('앞면')
    expect(html).toContain('뜻')
    expect(html).toContain('예문')
  })

  it('renders phrase cards using situation/note/alt', () => {
    const html = renderSampleCardsHtml(phraseSamples, 'ko', 'Real Conv 시사')
    expect(html).toContain('요즘 물가가 미쳤어')
    expect(html).toContain('Prices are insane')
    // Apostrophe gets HTML-escaped to &#39; by escapeHtml — that's correct XSS hygiene.
    expect(html).toContain('Everything&#39;s so pricey now.')
    expect(html).toContain('물가')
    expect(html).toContain('cost of living = 생활비')
    expect(html).toContain('상황')
    expect(html).toContain('메모')
  })

  it('marks each sample as schema.org LearningResource', () => {
    const html = renderSampleCardsHtml(wordSamples, 'en', 'X')
    const matches = html.match(/itemtype="https:\/\/schema\.org\/LearningResource"/g)
    expect(matches).not.toBeNull()
    expect(matches.length).toBe(wordSamples.length)
  })

  it('escapes HTML in field values to prevent XSS', () => {
    const evil = [{
      field_values: {
        front: '<script>alert(1)</script>',
        back: 'safe & sound',
      },
    }]
    const html = renderSampleCardsHtml(evil, 'en', 'X')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('safe &amp; sound')
  })

  it('skips entries with empty field_values gracefully', () => {
    const mixed = [
      { field_values: {} },
      ...wordSamples,
    ]
    const html = renderSampleCardsHtml(mixed, 'en', 'X')
    expect(html).toContain('ontology')
    const cardCount = (html.match(/itemtype="https:\/\/schema\.org\/LearningResource"/g) || []).length
    expect(cardCount).toBe(wordSamples.length)
  })
})

describe('buildSampleCardLearningResources', () => {
  it('returns one LearningResource per sample with @id, name, teaches', () => {
    const result = buildSampleCardLearningResources(wordSamples, 'abc-123', 'en')
    expect(result).toHaveLength(2)
    expect(result[0]['@type']).toBe('LearningResource')
    expect(result[0]['@id']).toBe('https://reeeeecallstudy.xyz/d/abc-123#card-1')
    expect(result[0].name).toBe('ontology')
    expect(result[0].teaches).toContain('存在論')
    expect(result[0].teaches).toContain('Ontology investigates')
    expect(result[0].learningResourceType).toBe('Flashcard')
    expect(result[0].inLanguage).toBe('en')
  })

  it('skips cards without front or back', () => {
    const partial = [
      { field_values: { example_front: 'no front, no back' } },
      ...wordSamples,
    ]
    const result = buildSampleCardLearningResources(partial, 'x', 'en')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('ontology')
  })

  it('returns empty array on missing or non-array input', () => {
    expect(buildSampleCardLearningResources(null, 'x', 'en')).toEqual([])
    expect(buildSampleCardLearningResources(undefined, 'x', 'en')).toEqual([])
  })

  it('works for phrase cards too', () => {
    const result = buildSampleCardLearningResources(phraseSamples, 'p', 'ko')
    expect(result[0].name).toBe('요즘 물가가 미쳤어')
    expect(result[0].teaches).toContain('Prices are insane')
  })
})
