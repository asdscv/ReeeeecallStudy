import { describe, it, expect } from 'vitest'
import { checkSameRunDuplicate } from '../dedup.js'

describe('checkSameRunDuplicate', () => {
  it('returns isDuplicate:false when runState is null', () => {
    const result = checkSameRunDuplicate(
      { slug: 'test', title: 'Test', tags: ['a'], locale: 'en' },
      null,
    )
    expect(result.isDuplicate).toBe(false)
  })

  it('returns isDuplicate:false when runState is undefined', () => {
    const result = checkSameRunDuplicate(
      { slug: 'test', title: 'Test', tags: ['a'], locale: 'en' },
      undefined,
    )
    expect(result.isDuplicate).toBe(false)
  })

  it('returns isDuplicate:false when runState is empty', () => {
    const runState = { slugs: new Set(), titles: [] }
    const result = checkSameRunDuplicate(
      { slug: 'test', title: 'Test Article', tags: ['a'], locale: 'en' },
      runState,
    )
    expect(result.isDuplicate).toBe(false)
  })

  it('detects exact slug collision within same run', () => {
    const runState = {
      slugs: new Set(['my-article__en']),
      titles: [{ title: 'My Article Title', locale: 'en' }],
    }

    const result = checkSameRunDuplicate(
      { slug: 'my-article', title: 'Completely Different Title', tags: ['x'], locale: 'en' },
      runState,
    )

    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('same_run_slug_collision')
  })

  it('does NOT flag slug collision across different locales', () => {
    const runState = {
      slugs: new Set(['my-article__en']),
      titles: [{ title: 'My Article', locale: 'en' }],
    }

    const result = checkSameRunDuplicate(
      { slug: 'my-article', title: 'Different Title', tags: ['x'], locale: 'ko' },
      runState,
    )

    // slug key is "my-article__ko" which is not in the set
    expect(result.isDuplicate).toBe(false)
  })

  it('detects title similarity within same run (Jaccard > 0.5)', () => {
    const runState = {
      slugs: new Set(),
      titles: [
        { title: 'Effective Study Techniques for Medical Students', locale: 'en' },
      ],
    }

    const result = checkSameRunDuplicate(
      {
        slug: 'different-slug',
        title: 'Study Techniques for Medical Students That Work',
        tags: ['x'],
        locale: 'en',
      },
      runState,
    )

    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('same_run_title_similar')
    expect(result.similarity).toBeGreaterThan(0.5)
  })

  it('does NOT flag different titles as similar', () => {
    const runState = {
      slugs: new Set(),
      titles: [
        { title: 'Quantum Physics and Modern Computing', locale: 'en' },
      ],
    }

    const result = checkSameRunDuplicate(
      {
        slug: 'other-slug',
        title: 'Ancient History of Roman Architecture',
        tags: ['x'],
        locale: 'en',
      },
      runState,
    )

    expect(result.isDuplicate).toBe(false)
  })

  it('only compares titles within the same locale', () => {
    const runState = {
      slugs: new Set(),
      titles: [
        { title: 'Effective Study Techniques for Students', locale: 'ko' },
      ],
    }

    // Same title but different locale should NOT match
    const result = checkSameRunDuplicate(
      {
        slug: 'any-slug',
        title: 'Effective Study Techniques for Students',
        tags: ['x'],
        locale: 'en',
      },
      runState,
    )

    expect(result.isDuplicate).toBe(false)
  })

  it('handles runState with missing titles array', () => {
    const runState = { slugs: new Set() }

    const result = checkSameRunDuplicate(
      { slug: 'test', title: 'Test', tags: ['a'], locale: 'en' },
      runState,
    )

    expect(result.isDuplicate).toBe(false)
  })

  it('checks against multiple same-run articles', () => {
    const runState = {
      slugs: new Set(['slug-a__en', 'slug-b__en']),
      titles: [
        { title: 'First Article About Learning Science', locale: 'en' },
        { title: 'Second Article About Exam Preparation', locale: 'en' },
      ],
    }

    // Should match slug-b
    const result = checkSameRunDuplicate(
      { slug: 'slug-b', title: 'Totally New Topic', tags: ['x'], locale: 'en' },
      runState,
    )

    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('same_run_slug_collision')
  })
})
