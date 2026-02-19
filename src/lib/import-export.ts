import Papa from 'papaparse'
import type { Deck, CardTemplate, Card, TemplateField } from '../types/database'

// --- Export Types ---

interface ExportData {
  version: number
  exportedAt: string
  deck: {
    name: string
    description: string | null
    color: string
    icon: string
  }
  template: {
    name: string
    fields: TemplateField[]
    front_layout: CardTemplate['front_layout']
    back_layout: CardTemplate['back_layout']
    layout_mode: CardTemplate['layout_mode']
    front_html: string
    back_html: string
  }
  cards: Array<{
    field_values: Record<string, string>
    tags: string[]
  }>
}

// --- Template Export Types ---

interface TemplateExportData {
  version: number
  exportedAt: string
  template: {
    name: string
    fields: TemplateField[]
    front_layout: CardTemplate['front_layout']
    back_layout: CardTemplate['back_layout']
    layout_mode: CardTemplate['layout_mode']
    front_html: string
    back_html: string
  }
}

// --- Import Types ---

export interface ImportCard {
  field_values: Record<string, string>
  tags: string[]
}

interface ImportJSONResult {
  deckName: string
  template: { name: string; fields: TemplateField[] } | null
  cards: ImportCard[]
}

interface ValidationResult {
  valid: ImportCard[]
  invalid: ImportCard[]
}

interface DuplicateResult {
  duplicates: ImportCard[]
  unique: ImportCard[]
}

// --- Export Functions ---

export function generateExportJSON(deck: Deck, template: CardTemplate, cards: Card[]): string {
  const data: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    deck: {
      name: deck.name,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
    },
    template: {
      name: template.name,
      fields: template.fields,
      front_layout: template.front_layout,
      back_layout: template.back_layout,
      layout_mode: template.layout_mode,
      front_html: template.front_html,
      back_html: template.back_html,
    },
    cards: cards.map((c) => ({
      field_values: c.field_values,
      tags: c.tags,
    })),
  }
  return JSON.stringify(data, null, 2)
}

export const TAGS_COLUMN_KEY = 'import:tags'

export function generateExportCSV(cards: Card[], fields: TemplateField[], tagsLabel = 'Tags'): string {
  const headers = [...fields.map((f) => f.name), tagsLabel]
  const rows = cards.map((card) => {
    const row: Record<string, string> = {}
    for (const field of fields) {
      row[field.name] = card.field_values[field.key] ?? ''
    }
    row[tagsLabel] = card.tags.join(';')
    return row
  })

  return Papa.unparse({
    fields: headers,
    data: rows.map((row) => headers.map((h) => row[h])),
  })
}

// --- Template Export Functions ---

export function generateTemplateExportJSON(template: CardTemplate): string {
  const data: TemplateExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: template.name,
      fields: template.fields,
      front_layout: template.front_layout,
      back_layout: template.back_layout,
      layout_mode: template.layout_mode,
      front_html: template.front_html,
      back_html: template.back_html,
    },
  }
  return JSON.stringify(data, null, 2)
}

export function generateTemplateExportCSV(template: CardTemplate): string {
  const fieldRows = template.fields.map((f) => ({
    key: f.key,
    name: f.name,
    type: f.type,
    order: f.order,
    tts_enabled: f.tts_enabled ? 'true' : 'false',
    tts_lang: f.tts_lang ?? '',
  }))

  const headers = ['key', 'name', 'type', 'order', 'tts_enabled', 'tts_lang']

  return Papa.unparse({
    fields: headers,
    data: fieldRows.map((row) => headers.map((h) => String(row[h as keyof typeof row]))),
  })
}

// --- Import Functions ---

export function parseImportJSON(jsonString: string): ImportJSONResult {
  const data = JSON.parse(jsonString)

  if (!data.cards || !Array.isArray(data.cards)) {
    throw new Error('errors:import.invalidFile')
  }

  return {
    deckName: data.deck?.name ?? '',
    template: data.template
      ? { name: data.template.name, fields: data.template.fields }
      : null,
    cards: data.cards.map((c: Record<string, unknown>) => ({
      field_values: (c.field_values ?? {}) as Record<string, string>,
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
    })),
  }
}

export function parseImportCSV(csvString: string, fieldMapping: Record<string, string>, tagsLabel = 'Tags'): ImportCard[] {
  const result = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
  })

  return result.data.map((row) => {
    const fieldValues: Record<string, string> = {}
    for (const [csvHeader, fieldKey] of Object.entries(fieldMapping)) {
      if (row[csvHeader] !== undefined) {
        fieldValues[fieldKey] = row[csvHeader]
      }
    }

    const tagsRaw = row[tagsLabel] ?? row['태그'] ?? row['Tags'] ?? ''
    const tags = tagsRaw
      ? tagsRaw.split(';').map((t) => t.trim()).filter(Boolean)
      : []

    return { field_values: fieldValues, tags }
  })
}

export function validateImportCards(cards: ImportCard[]): ValidationResult {
  const valid: ImportCard[] = []
  const invalid: ImportCard[] = []

  for (const card of cards) {
    const hasValue = Object.values(card.field_values).some((v) => v.trim() !== '')
    if (hasValue) {
      valid.push(card)
    } else {
      invalid.push(card)
    }
  }

  return { valid, invalid }
}

export function detectDuplicates(existingCards: Card[], newCards: ImportCard[]): DuplicateResult {
  const existingKeys = new Set(
    existingCards.map((c) => JSON.stringify(c.field_values))
  )

  const duplicates: ImportCard[] = []
  const unique: ImportCard[] = []

  for (const card of newCards) {
    const key = JSON.stringify(card.field_values)
    if (existingKeys.has(key)) {
      duplicates.push(card)
    } else {
      unique.push(card)
    }
  }

  return { duplicates, unique }
}
