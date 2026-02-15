import { describe, it, expect } from 'vitest'
import {
  GUIDE_SECTIONS,
  searchGuide,
  getSection,
} from '../guide-content'

describe('GUIDE_SECTIONS', () => {
  it('should have at least 5 sections', () => {
    expect(GUIDE_SECTIONS.length).toBeGreaterThanOrEqual(5)
  })

  it('every section should have id, title, icon, and non-empty items', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.id).toBeTruthy()
      expect(section.title).toBeTruthy()
      expect(section.icon).toBeTruthy()
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it('every item should have title and body', () => {
    for (const section of GUIDE_SECTIONS) {
      for (const item of section.items) {
        expect(item.title).toBeTruthy()
        expect(item.body).toBeTruthy()
      }
    }
  })

  it('login guide should describe email/password authentication', () => {
    const gettingStarted = GUIDE_SECTIONS.find((s) => s.id === 'getting-started')
    expect(gettingStarted).toBeDefined()
    const loginItem = gettingStarted!.items.find((i) => i.title === '로그인')
    expect(loginItem).toBeDefined()
    expect(loginItem!.body).toContain('비밀번호')
    expect(loginItem!.body).not.toContain('매직 링크')
    expect(loginItem!.body).not.toContain('비밀번호 없이')
  })

  it('all section ids should be unique', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getSection', () => {
  it('should return section by id', () => {
    const first = GUIDE_SECTIONS[0]
    const found = getSection(first.id)
    expect(found).toBe(first)
  })

  it('should return undefined for unknown id', () => {
    expect(getSection('nonexistent-section')).toBeUndefined()
  })
})

describe('searchGuide', () => {
  it('should return all sections when query is empty', () => {
    const result = searchGuide('')
    expect(result.length).toBe(GUIDE_SECTIONS.length)
  })

  it('should return all sections for whitespace query', () => {
    const result = searchGuide('   ')
    expect(result.length).toBe(GUIDE_SECTIONS.length)
  })

  it('should filter sections by section title', () => {
    // Every section has a title — search for a word from the first section title
    const firstTitle = GUIDE_SECTIONS[0].title
    const word = firstTitle.split(' ')[0]
    if (!word) return // skip if title is somehow empty

    const result = searchGuide(word)
    expect(result.length).toBeGreaterThan(0)
    // At least one returned section should match
    const titles = result.map((s) => s.title)
    expect(titles.some((t) => t.includes(word))).toBe(true)
  })

  it('should filter sections by item title or body', () => {
    // Pick a word from the first item of the first section body
    const body = GUIDE_SECTIONS[0].items[0].body
    const words = body.split(/\s+/).filter((w) => w.length > 2)
    if (words.length === 0) return

    const keyword = words[0]
    const result = searchGuide(keyword)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should be case-insensitive', () => {
    const result1 = searchGuide('SRS')
    const result2 = searchGuide('srs')
    expect(result1.length).toBe(result2.length)
  })

  it('should return sections with only matching items', () => {
    // Use a very specific search term unlikely to appear everywhere
    const result = searchGuide('SRS')
    for (const section of result) {
      const sectionTitleMatch = section.title.toLowerCase().includes('srs')
      const itemMatch = section.items.some(
        (item) =>
          item.title.toLowerCase().includes('srs') ||
          item.body.toLowerCase().includes('srs')
      )
      expect(sectionTitleMatch || itemMatch).toBe(true)
    }
  })
})
