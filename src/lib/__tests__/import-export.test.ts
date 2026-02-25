import { describe, it, expect } from 'vitest'
import {
  generateExportJSON,
  generateExportCSV,
  generateCSVTemplate,
  parseImportJSON,
  parseImportCSV,
  validateImportCards,
  detectDuplicates,
} from '../import-export'
import Papa from 'papaparse'
import type { Deck, CardTemplate, Card, TemplateField } from '../../types/database'

// --- helpers ---

function makeDeck(overrides?: Partial<Deck>): Deck {
  return {
    id: 'deck-1',
    user_id: 'user-1',
    name: 'Test Deck',
    description: 'A test deck',
    default_template_id: 'tmpl-1',
    color: '#3B82F6',
    icon: '📚',
    is_archived: false,
    sort_order: 0,
    next_position: 2,
    srs_settings: { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4 },
    share_mode: null,
    source_deck_id: null,
    source_owner_id: null,
    is_readonly: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTemplate(overrides?: Partial<CardTemplate>): CardTemplate {
  return {
    id: 'tmpl-1',
    user_id: 'user-1',
    name: 'Basic',
    fields: [
      { key: 'front', name: '앞면', type: 'text', order: 0 },
      { key: 'back', name: '뒷면', type: 'text', order: 1 },
    ] as TemplateField[],
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: [{ field_key: 'back', style: 'primary' }],
    layout_mode: 'default',
    front_html: '',
    back_html: '',
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'hello', back: '안녕하세요' },
    tags: ['greetings'],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

// --- Tests ---

describe('generateExportJSON', () => {
  it('should generate valid JSON string with deck, template, and cards', () => {
    const deck = makeDeck()
    const template = makeTemplate()
    const cards = [makeCard(), makeCard({ id: 'card-2', field_values: { front: 'world', back: '세계' } })]

    const json = generateExportJSON(deck, template, cards)
    const parsed = JSON.parse(json)

    expect(parsed.version).toBe(1)
    expect(parsed.deck.name).toBe('Test Deck')
    expect(parsed.template.name).toBe('Basic')
    expect(parsed.cards).toHaveLength(2)
    expect(parsed.cards[0].field_values.front).toBe('hello')
  })

  it('should include tags in card data', () => {
    const json = generateExportJSON(makeDeck(), makeTemplate(), [makeCard()])
    const parsed = JSON.parse(json)
    expect(parsed.cards[0].tags).toEqual(['greetings'])
  })
})

describe('generateExportCSV', () => {
  it('should generate CSV string with field names as headers', () => {
    const fields: TemplateField[] = [
      { key: 'front', name: '앞면', type: 'text', order: 0 },
      { key: 'back', name: '뒷면', type: 'text', order: 1 },
    ]
    const cards = [
      makeCard(),
      makeCard({ id: 'card-2', field_values: { front: 'world', back: '세계' } }),
    ]

    const csv = generateExportCSV(cards, fields)
    const lines = csv.trim().split('\n')

    // Header should contain field names
    expect(lines[0]).toContain('앞면')
    expect(lines[0]).toContain('뒷면')
    // Should have header + 2 data rows
    expect(lines.length).toBe(3)
  })

  it('should include tags column', () => {
    const fields: TemplateField[] = [
      { key: 'front', name: '앞면', type: 'text', order: 0 },
    ]
    const cards = [makeCard({ field_values: { front: 'hello' }, tags: ['a', 'b'] })]

    const csv = generateExportCSV(cards, fields)
    expect(csv).toContain('Tags')
    expect(csv).toContain('a;b')
  })
})

describe('generateCSVTemplate', () => {
  it('should generate CSV with headers only (no data rows)', () => {
    const fields: TemplateField[] = [
      { key: 'front', name: 'Front', type: 'text', order: 0 },
      { key: 'back', name: 'Back', type: 'text', order: 1 },
    ]
    const csv = generateCSVTemplate(fields)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Front')
    expect(lines[0]).toContain('Back')
  })

  it('should have Tags as the last column', () => {
    const fields: TemplateField[] = [
      { key: 'word', name: 'Word', type: 'text', order: 0 },
    ]
    const csv = generateCSVTemplate(fields)
    const headers = csv.trim().split(',')
    expect(headers[headers.length - 1]).toBe('Tags')
  })

  it('should handle empty fields array', () => {
    const csv = generateCSVTemplate([])
    expect(csv.trim()).toBe('Tags')
  })

  it('should be parseable by PapaParse', () => {
    const fields: TemplateField[] = [
      { key: 'front', name: 'Front', type: 'text', order: 0 },
      { key: 'back', name: 'Back', type: 'text', order: 1 },
    ]
    const csv = generateCSVTemplate(fields)
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true })
    expect(parsed.meta.fields).toEqual(['Front', 'Back', 'Tags'])
    expect(parsed.data).toHaveLength(0)
  })
})

describe('parseImportJSON', () => {
  it('should parse valid JSON export string', () => {
    const exportData = {
      version: 1,
      deck: { name: 'Test Deck' },
      template: { name: 'Basic', fields: [{ key: 'front', name: '앞면', type: 'text', order: 0 }] },
      cards: [
        { field_values: { front: 'hello' }, tags: ['a'] },
        { field_values: { front: 'world' }, tags: [] },
      ],
    }
    const result = parseImportJSON(JSON.stringify(exportData))

    expect(result.deckName).toBe('Test Deck')
    expect(result.template?.name).toBe('Basic')
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0].field_values.front).toBe('hello')
  })

  it('should throw on invalid JSON', () => {
    expect(() => parseImportJSON('not json')).toThrow()
  })

  it('should throw when cards array is missing', () => {
    expect(() => parseImportJSON(JSON.stringify({ version: 1 }))).toThrow()
  })
})

describe('parseImportCSV', () => {
  it('should parse CSV with field mapping', () => {
    const csv = '앞면,뒷면,태그\nhello,안녕하세요,greetings\nworld,세계,'
    const fieldMapping: Record<string, string> = {
      '앞면': 'front',
      '뒷면': 'back',
    }

    const cards = parseImportCSV(csv, fieldMapping)
    expect(cards).toHaveLength(2)
    expect(cards[0].field_values.front).toBe('hello')
    expect(cards[0].field_values.back).toBe('안녕하세요')
    expect(cards[0].tags).toEqual(['greetings'])
  })

  it('should handle CSV without tags column', () => {
    const csv = '앞면,뒷면\nhello,안녕하세요'
    const fieldMapping: Record<string, string> = {
      '앞면': 'front',
      '뒷면': 'back',
    }

    const cards = parseImportCSV(csv, fieldMapping)
    expect(cards[0].tags).toEqual([])
  })

  it('should handle semicolon-separated tags', () => {
    const csv = '앞면,태그\nhello,a;b;c'
    const fieldMapping: Record<string, string> = { '앞면': 'front' }

    const cards = parseImportCSV(csv, fieldMapping)
    expect(cards[0].tags).toEqual(['a', 'b', 'c'])
  })
})

describe('validateImportCards', () => {
  it('should separate valid and invalid cards', () => {
    const cards: { field_values: Record<string, string>; tags: string[] }[] = [
      { field_values: { front: 'hello', back: '안녕' }, tags: [] },
      { field_values: { front: '', back: '' }, tags: [] },
      { field_values: {}, tags: [] },
      { field_values: { front: 'world' }, tags: [] },
    ]

    const result = validateImportCards(cards)
    expect(result.valid).toHaveLength(2) // first and last
    expect(result.invalid).toHaveLength(2) // second and third
  })

  it('should treat whitespace-only values as empty', () => {
    const cards: { field_values: Record<string, string>; tags: string[] }[] = [
      { field_values: { front: '  ', back: '  ' }, tags: [] },
    ]
    const result = validateImportCards(cards)
    expect(result.valid).toHaveLength(0)
    expect(result.invalid).toHaveLength(1)
  })
})

describe('detectDuplicates', () => {
  it('should detect duplicates based on field_values match', () => {
    const existing = [
      makeCard({ field_values: { front: 'hello', back: '안녕' } }),
    ]
    const incoming = [
      { field_values: { front: 'hello', back: '안녕' }, tags: [] },
      { field_values: { front: 'world', back: '세계' }, tags: [] },
    ]

    const result = detectDuplicates(existing, incoming)
    expect(result.duplicates).toHaveLength(1)
    expect(result.unique).toHaveLength(1)
    expect(result.unique[0].field_values.front).toBe('world')
  })

  it('should return all as unique if no existing cards', () => {
    const incoming = [
      { field_values: { front: 'hello' }, tags: [] },
    ]
    const result = detectDuplicates([], incoming)
    expect(result.duplicates).toHaveLength(0)
    expect(result.unique).toHaveLength(1)
  })
})
