import { describe, it, expect } from 'vitest'
import {
  API_DOCS_SECTIONS,
  searchApiDocs,
  getApiSection,
  getMethodColor,
  getStatusColor,
  type ApiEndpoint,
} from '../api-docs-content'

describe('API_DOCS_SECTIONS', () => {
  it('should have at least 5 sections', () => {
    expect(API_DOCS_SECTIONS.length).toBeGreaterThanOrEqual(5)
  })

  it('every section should have id, title (i18n key), icon, and description (i18n key)', () => {
    for (const section of API_DOCS_SECTIONS) {
      expect(section.id).toBeTruthy()
      expect(section.title).toBeTruthy()
      expect(section.title).toContain('sections.')
      expect(section.icon).toBeTruthy()
      expect(section.description).toBeTruthy()
      expect(section.description).toContain('sections.')
    }
  })

  it('all section ids should be unique', () => {
    const ids = API_DOCS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every section should have at least items or endpoints', () => {
    for (const section of API_DOCS_SECTIONS) {
      const hasItems = section.items && section.items.length > 0
      const hasEndpoints = section.endpoints && section.endpoints.length > 0
      expect(hasItems || hasEndpoints).toBe(true)
    }
  })

  it('section items should have title and body (i18n keys or literal)', () => {
    for (const section of API_DOCS_SECTIONS) {
      if (section.items) {
        for (const item of section.items) {
          expect(item.title).toBeTruthy()
          // body can be empty string for code example items
          expect(typeof item.body).toBe('string')
        }
      }
    }
  })

  it('endpoints should have valid method, path, summary (i18n key), description (i18n key)', () => {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    for (const section of API_DOCS_SECTIONS) {
      if (section.endpoints) {
        for (const ep of section.endpoints) {
          expect(validMethods).toContain(ep.method)
          expect(ep.path).toBeTruthy()
          expect(ep.path.startsWith('/')).toBe(true)
          expect(ep.summary).toBeTruthy()
          expect(ep.summary).toContain('sections.')
          expect(ep.description).toBeTruthy()
          expect(ep.description).toContain('sections.')
        }
      }
    }
  })

  it('endpoints should have at least one status code', () => {
    for (const section of API_DOCS_SECTIONS) {
      if (section.endpoints) {
        for (const ep of section.endpoints) {
          expect(ep.statusCodes).toBeDefined()
          expect(ep.statusCodes!.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('endpoints with request bodies should have Content-Type header', () => {
    for (const section of API_DOCS_SECTIONS) {
      if (section.endpoints) {
        for (const ep of section.endpoints) {
          if (ep.requestBody) {
            const hasContentType = ep.headers?.some(
              (h) => h.name === 'Content-Type'
            )
            expect(hasContentType).toBe(true)
          }
        }
      }
    }
  })

  it('should include authentication section', () => {
    const authSection = API_DOCS_SECTIONS.find((s) => s.id === 'authentication')
    expect(authSection).toBeDefined()
  })

  it('should include rate-limits section', () => {
    const rlSection = API_DOCS_SECTIONS.find((s) => s.id === 'rate-limits')
    expect(rlSection).toBeDefined()
  })

  it('should include code examples section', () => {
    const exSection = API_DOCS_SECTIONS.find((s) => s.id === 'examples')
    expect(exSection).toBeDefined()
    expect(exSection!.items!.length).toBeGreaterThanOrEqual(2)
  })

  it('should include error handling section', () => {
    const errSection = API_DOCS_SECTIONS.find((s) => s.id === 'errors')
    expect(errSection).toBeDefined()
  })
})

describe('getApiSection', () => {
  it('should return section by id', () => {
    const first = API_DOCS_SECTIONS[0]
    const found = getApiSection(first.id)
    expect(found).toBe(first)
  })

  it('should return undefined for unknown id', () => {
    expect(getApiSection('nonexistent-section')).toBeUndefined()
  })

  it('should find each known section', () => {
    const knownIds = ['overview', 'authentication', 'rate-limits', 'decks', 'cards', 'study', 'templates', 'examples', 'errors']
    for (const id of knownIds) {
      expect(getApiSection(id)).toBeDefined()
    }
  })
})

describe('searchApiDocs', () => {
  // Mock t function: returns the key as-is (identity)
  const mockT = (key: string) => key

  it('should return all sections when query is empty', () => {
    const result = searchApiDocs('', mockT)
    expect(result.length).toBe(API_DOCS_SECTIONS.length)
  })

  it('should return all sections for whitespace query', () => {
    const result = searchApiDocs('   ', mockT)
    expect(result.length).toBe(API_DOCS_SECTIONS.length)
  })

  it('should filter by section title key', () => {
    const result = searchApiDocs('authentication', mockT)
    expect(result.length).toBeGreaterThan(0)
    const authFound = result.some((s) => s.id === 'authentication')
    expect(authFound).toBe(true)
  })

  it('should filter by section description key', () => {
    const result = searchApiDocs('overview.description', mockT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by endpoint path', () => {
    const result = searchApiDocs('/decks', mockT)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should filter by endpoint method', () => {
    const result = searchApiDocs('POST', mockT)
    expect(result.length).toBeGreaterThan(0)
    for (const section of result) {
      if (section.endpoints) {
        expect(
          section.endpoints.some((ep) => ep.method === 'POST') ||
          section.title.toLowerCase().includes('post') ||
          section.description.toLowerCase().includes('post')
        ).toBe(true)
      }
    }
  })

  it('should be case-insensitive', () => {
    const result1 = searchApiDocs('GET', mockT)
    const result2 = searchApiDocs('get', mockT)
    expect(result1.length).toBe(result2.length)
  })

  it('should return empty array for unmatched query', () => {
    const result = searchApiDocs('xyz존재하지않는키워드999', mockT)
    expect(result.length).toBe(0)
  })

  it('should return section with only matching items when section title does not match', () => {
    // 'cURL' appears in code examples items (literal title)
    const result = searchApiDocs('cURL', mockT)
    const exSection = result.find((s) => s.id === 'examples')
    if (exSection && exSection.items) {
      const hasCurl = exSection.items.some(
        (item) =>
          item.title.toLowerCase().includes('curl') ||
          item.body.toLowerCase().includes('curl')
      )
      expect(hasCurl).toBe(true)
    }
  })
})

describe('getMethodColor', () => {
  it('should return green for GET', () => {
    expect(getMethodColor('GET')).toContain('green')
  })

  it('should return blue for POST', () => {
    expect(getMethodColor('POST')).toContain('blue')
  })

  it('should return yellow for PUT', () => {
    expect(getMethodColor('PUT')).toContain('yellow')
  })

  it('should return orange for PATCH', () => {
    expect(getMethodColor('PATCH')).toContain('orange')
  })

  it('should return red for DELETE', () => {
    expect(getMethodColor('DELETE')).toContain('red')
  })

  it('should return tailwind class string format', () => {
    const methods: ApiEndpoint['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    for (const method of methods) {
      const color = getMethodColor(method)
      expect(color).toContain('bg-')
      expect(color).toContain('text-')
    }
  })
})

describe('getStatusColor', () => {
  it('should return green for 2xx codes', () => {
    expect(getStatusColor(200)).toContain('green')
    expect(getStatusColor(201)).toContain('green')
    expect(getStatusColor(204)).toContain('green')
  })

  it('should return yellow for 4xx codes', () => {
    expect(getStatusColor(400)).toContain('yellow')
    expect(getStatusColor(401)).toContain('yellow')
    expect(getStatusColor(404)).toContain('yellow')
    expect(getStatusColor(429)).toContain('yellow')
  })

  it('should return red for 5xx codes', () => {
    expect(getStatusColor(500)).toContain('red')
  })
})
