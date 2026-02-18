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

  it('every section should have id, title (i18n key), icon, and non-empty items', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.id).toBeTruthy()
      expect(section.title).toBeTruthy()
      expect(section.title).toContain('sections.')
      expect(section.icon).toBeTruthy()
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it('every item should have title and body (i18n keys)', () => {
    for (const section of GUIDE_SECTIONS) {
      for (const item of section.items) {
        expect(item.title).toBeTruthy()
        expect(item.body).toBeTruthy()
      }
    }
  })

  it('login guide item should exist with i18n key', () => {
    const gettingStarted = GUIDE_SECTIONS.find((s) => s.id === 'getting-started')
    expect(gettingStarted).toBeDefined()
    const loginItem = gettingStarted!.items.find((i) => i.title.includes('login'))
    expect(loginItem).toBeDefined()
    expect(loginItem!.body).toContain('login')
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
  // Mock t function: returns the key as-is (identity)
  const mockT = (key: string) => key

  it('should return all sections when query is empty', () => {
    const result = searchGuide('', mockT)
    expect(result.length).toBe(GUIDE_SECTIONS.length)
  })

  it('should return all sections for whitespace query', () => {
    const result = searchGuide('   ', mockT)
    expect(result.length).toBe(GUIDE_SECTIONS.length)
  })

  it('should filter sections by section title key', () => {
    // Search for a substring of the first section title key
    const word = 'getting-started'

    const result = searchGuide(word, mockT)
    expect(result.length).toBeGreaterThan(0)
    const titles = result.map((s) => s.title)
    expect(titles.some((t) => t.includes(word))).toBe(true)
  })

  it('should filter sections by item title or body key', () => {
    // Search for a substring of a known item key
    const keyword = 'login'
    const result = searchGuide(keyword, mockT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should be case-insensitive', () => {
    const result1 = searchGuide('SRS', mockT)
    const result2 = searchGuide('srs', mockT)
    expect(result1.length).toBe(result2.length)
  })

  it('should return sections with only matching items', () => {
    const result = searchGuide('srs', mockT)
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
