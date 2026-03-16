import type {
  GeneratedTemplate,
  GeneratedTemplateField,
  GeneratedLayoutItem,
  GeneratedDeck,
  GeneratedCard,
} from './types'

const VALID_STYLES = ['primary', 'secondary', 'hint', 'detail']
const VALID_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64]
const VALID_COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

export function validateTemplateResponse(data: unknown): GeneratedTemplate {
  if (!data || typeof data !== 'object') throw new Error('INVALID_RESPONSE')

  const d = data as Record<string, unknown>

  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (!name) throw new Error('INVALID_RESPONSE')

  const fields = validateFields(d.fields)
  if (fields.length < 2) throw new Error('INVALID_RESPONSE')

  const fieldKeys = new Set(fields.map((f) => f.key))
  const frontLayout = validateLayout(d.front_layout, fieldKeys)
  const backLayout = validateLayout(d.back_layout, fieldKeys)

  if (frontLayout.length === 0) throw new Error('INVALID_RESPONSE')

  const layoutMode = d.layout_mode === 'custom' ? 'custom' : 'default'

  return {
    name,
    fields,
    front_layout: frontLayout,
    back_layout: backLayout,
    layout_mode: layoutMode,
    front_html: layoutMode === 'custom' && typeof d.front_html === 'string' ? d.front_html : '',
    back_html: layoutMode === 'custom' && typeof d.back_html === 'string' ? d.back_html : '',
  }
}

function validateFields(raw: unknown): GeneratedTemplateField[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((f): f is Record<string, unknown> => f && typeof f === 'object')
    .map((f, i) => ({
      key: typeof f.key === 'string' && f.key.startsWith('field_') ? f.key : `field_${i}`,
      name: typeof f.name === 'string' ? f.name : `Field ${i + 1}`,
      type: 'text' as const,
      order: typeof f.order === 'number' ? f.order : i,
      tts_enabled: typeof f.tts_enabled === 'boolean' ? f.tts_enabled : false,
      tts_lang: typeof f.tts_lang === 'string' ? f.tts_lang : undefined,
    }))
    .slice(0, 6)
}

function validateLayout(raw: unknown, validKeys: Set<string>): GeneratedLayoutItem[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .filter((item) => typeof item.field_key === 'string' && validKeys.has(item.field_key))
    .map((item) => ({
      field_key: item.field_key as string,
      style: (VALID_STYLES.includes(item.style as string) ? item.style : 'primary') as GeneratedLayoutItem['style'],
      font_size: typeof item.font_size === 'number' && VALID_FONT_SIZES.includes(item.font_size)
        ? item.font_size
        : undefined,
    }))
}

export function validateDeckResponse(data: unknown): GeneratedDeck {
  if (!data || typeof data !== 'object') throw new Error('INVALID_RESPONSE')

  const d = data as Record<string, unknown>

  const name = typeof d.name === 'string' ? d.name.trim() : ''
  if (!name) throw new Error('INVALID_RESPONSE')

  return {
    name,
    description: typeof d.description === 'string' ? d.description : '',
    color: typeof d.color === 'string' && VALID_COLORS.includes(d.color) ? d.color : '#3B82F6',
    icon: typeof d.icon === 'string' && d.icon.length <= 4 ? d.icon : '📚',
  }
}

export interface CardsValidationResult {
  valid: GeneratedCard[]
  filtered: number
}

export function validateCardsResponse(
  data: unknown,
  fieldKeys: string[],
): CardsValidationResult {
  if (!data || typeof data !== 'object') throw new Error('INVALID_RESPONSE')

  const d = data as Record<string, unknown>
  const cards = Array.isArray(d.cards) ? d.cards : []

  if (cards.length === 0) throw new Error('INVALID_RESPONSE')

  const keySet = new Set(fieldKeys)
  const valid: GeneratedCard[] = []
  let filtered = 0

  for (const card of cards) {
    if (!card || typeof card !== 'object') { filtered++; continue }

    const c = card as Record<string, unknown>
    const fv = c.field_values
    if (!fv || typeof fv !== 'object') { filtered++; continue }

    const fieldValues: Record<string, string> = {}
    let hasValue = false

    for (const key of keySet) {
      const val = (fv as Record<string, unknown>)[key]
      fieldValues[key] = typeof val === 'string' ? val : ''
      if (fieldValues[key]) hasValue = true
    }

    if (!hasValue) { filtered++; continue }

    const tags = Array.isArray(c.tags)
      ? c.tags.filter((t): t is string => typeof t === 'string')
      : []

    valid.push({ field_values: fieldValues, tags })
  }

  if (valid.length === 0) throw new Error('ALL_CARDS_INVALID')

  return { valid, filtered }
}
