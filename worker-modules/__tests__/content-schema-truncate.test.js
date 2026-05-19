import { describe, it, expect } from 'vitest'
import { truncateAtWordBoundary, validateArticle } from '../content-schema.js'

const BRAND_SUFFIX = ' | ReeeeecallStudy'

function makeArticle(overrides = {}) {
  return {
    title: 'A title',
    slug: 'a-slug',
    meta_title: 'Short title',
    meta_description: 'Short description.',
    tags: ['tag'],
    reading_time_minutes: 5,
    content_blocks: [{ type: 'paragraph', text: 'a' }],
    ...overrides,
  }
}

describe('truncateAtWordBoundary', () => {
  it('returns input unchanged when shorter than max', () => {
    expect(truncateAtWordBoundary('hello world', 42)).toBe('hello world')
  })

  it('trims at a space when one exists within budget threshold', () => {
    expect(truncateAtWordBoundary('one two three four five six seven', 20)).toBe('one two three four')
  })

  it('hard-cuts when no space exists within budget (single long word)', () => {
    expect(truncateAtWordBoundary('Supercalifragilisticexpialidocious word', 20)).toBe('Supercalifragilistic')
  })

  it('hard-cuts CJK (no spaces) without losing characters', () => {
    const cjk = '托福学术阅读高效略读技巧与提速策略全面解析提分必备指南完全攻略'
    const result = truncateAtWordBoundary(cjk, 20)
    expect(result.length).toBe(20)
    expect(result).toBe(cjk.slice(0, 20))
  })

  it('does not split a latin word mid-character', () => {
    const input = 'TOEFL Skimming Techniques for Academic Passages'
    const result = truncateAtWordBoundary(input, 42)
    expect(result.endsWith('Pas')).toBe(false)
    expect(result.split(' ').every((w) => input.includes(w))).toBe(true)
  })

  it('passes through non-string input', () => {
    expect(truncateAtWordBoundary(null, 10)).toBe(null)
    expect(truncateAtWordBoundary(123, 10)).toBe(123)
  })
})

describe('validateArticle meta_title truncation', () => {
  it('preserves Passages-word — no mid-word "Pas" cut', () => {
    const a = makeArticle({
      meta_title: 'TOEFL Skimming Techniques for Academic Passages',
    })
    validateArticle(a)
    expect(a.meta_title.endsWith(BRAND_SUFFIX)).toBe(true)
    expect(a.meta_title.length).toBeLessThanOrEqual(60)
    // The bug we are fixing: "Pas" + brand suffix
    expect(a.meta_title).not.toMatch(/Pas\s*\|/)
  })

  it('keeps short titles intact aside from brand suffix', () => {
    const a = makeArticle({ meta_title: 'Quick Tip' })
    validateArticle(a)
    expect(a.meta_title).toBe('Quick Tip' + BRAND_SUFFIX)
  })

  it('does not duplicate the brand suffix if already present', () => {
    const a = makeArticle({ meta_title: 'Quick Tip' + BRAND_SUFFIX })
    validateArticle(a)
    expect(a.meta_title).toBe('Quick Tip' + BRAND_SUFFIX)
  })
})

describe('validateArticle meta_description truncation', () => {
  it('trims at word boundary and appends ellipsis', () => {
    const longDesc =
      'Master toefl skimming for academic passages with proven strategies that improve speed and comprehension on test day. ' +
      'This guide covers the most reliable patterns you will encounter.'
    const a = makeArticle({ meta_description: longDesc })
    validateArticle(a)
    expect(a.meta_description.length).toBeLessThanOrEqual(155)
    expect(a.meta_description.endsWith('...')).toBe(true)
    // Body before "..." should not end on a partial word for latin text
    const body = a.meta_description.slice(0, -3)
    expect(body.endsWith(' ')).toBe(false)
    expect(longDesc.startsWith(body)).toBe(true)
  })
})
