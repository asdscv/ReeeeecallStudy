// Quick-Create presets defined by FIELD COUNT (front/back), not by language.
//
// The simple flow no longer depends on language-specific seeded templates
// (English/Chinese): the user just picks how many front/back fields a card has,
// types cards, done. On submit the modal finds-or-creates a card_template that
// matches the chosen shape (reused across that user's quick decks via a stable
// per-preset name + the card_templates(user_id,name) UNIQUE index).
//
// front is always 1 today (the four presets are 1+1 … 1+4), but the builders are
// written generically so adding more shapes is a one-line change here.

import type { TemplateField, LayoutItem } from '../types/database'

export interface QuickPreset {
  /** Stable id (used for the i18n label key + the UI testid). */
  id: string
  /** Number of front fields. */
  front: number
  /** Number of back fields. */
  back: number
  /** Stable card_template name for find-or-create (UNIQUE per user). */
  templateName: string
}

export const QUICK_PRESETS: QuickPreset[] = [
  { id: 'f1b1', front: 1, back: 1, templateName: '간편 카드 (1·1)' },
  { id: 'f1b2', front: 1, back: 2, templateName: '간편 카드 (1·2)' },
  { id: 'f1b3', front: 1, back: 3, templateName: '간편 카드 (1·3)' },
  { id: 'f1b4', front: 1, back: 4, templateName: '간편 카드 (1·4)' },
]

/** One input cell of a preset: its stable field key + which side/index it is. */
export interface QuickFieldSpec {
  key: string
  side: 'front' | 'back'
  /** 1-based index within its side (for "Back 2", "Back 3" labels). */
  index: number
}

/** The ordered field cells (front then back) for a preset's card rows. */
export function presetFieldSpecs(p: QuickPreset): QuickFieldSpec[] {
  const specs: QuickFieldSpec[] = []
  let n = 0
  for (let i = 0; i < p.front; i++) specs.push({ key: `field_${++n}`, side: 'front', index: i + 1 })
  for (let i = 0; i < p.back; i++) specs.push({ key: `field_${++n}`, side: 'back', index: i + 1 })
  return specs
}

/** Build the card_template shape (fields + front/back layouts) for a preset. */
export function buildPresetTemplate(p: QuickPreset): {
  fields: TemplateField[]
  front_layout: LayoutItem[]
  back_layout: LayoutItem[]
} {
  const fields: TemplateField[] = []
  const front_layout: LayoutItem[] = []
  const back_layout: LayoutItem[] = []

  for (const spec of presetFieldSpecs(p)) {
    const order = fields.length
    // First field of each side is unnumbered (앞면 / 뒷면); extras are numbered
    // (뒷면 2, 뒷면 3 …) — matches the position-based labels the quick-create UI
    // renders, so the stored template name and the input label agree.
    const base = spec.side === 'front' ? '앞면' : '뒷면'
    const name = spec.index === 1 ? base : `${base} ${spec.index}`
    fields.push({ key: spec.key, name, type: 'text', order })
    if (spec.side === 'front') {
      front_layout.push({ field_key: spec.key, style: 'primary' })
    } else {
      back_layout.push({ field_key: spec.key, style: spec.index === 1 ? 'primary' : 'detail' })
    }
  }

  return { fields, front_layout, back_layout }
}
