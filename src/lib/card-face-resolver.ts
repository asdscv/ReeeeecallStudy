/**
 * ═══════════════════════════════════════════════════════
 * card-face-resolver.ts — Card face content resolution
 *
 * Determines which layout items to render and provides
 * robust fallback values when template layout doesn't
 * match card field data.
 *
 * Pure functions, no side effects, fully testable.
 * ═══════════════════════════════════════════════════════
 */

import type { Card, CardTemplate, LayoutItem, TemplateField } from '../types/database'

export interface CardFaceContent {
  /**
   * Layout items that have non-empty matching field values.
   * Empty array → use fallbackValue instead of CardFaceLayout.
   */
  effectiveLayout: LayoutItem[]

  /**
   * Primary display value for this face.
   * Used as the "front reminder" text on the back face.
   */
  primaryValue: string

  /**
   * Text to display when effectiveLayout is empty.
   * Falls back to raw field_values by index.
   */
  fallbackValue: string

  /** Template fields (for CardFaceLayout field type lookup). Empty if no template. */
  fields: TemplateField[]

  /** Card field values (pass-through for rendering). */
  fieldValues: Record<string, string>
}

/**
 * Resolve the content to display on a card face.
 *
 * Handles all edge cases:
 *  - Template with matching field keys → effectiveLayout populated
 *  - Template with mismatched keys → effectiveLayout empty, fallbackValue set
 *  - Template with empty layout → effectiveLayout empty, fallbackValue set
 *  - Null template → effectiveLayout empty, fallbackValue from Object.values
 *  - Empty field_values → everything empty
 */
export function resolveCardFaceContent(
  template: CardTemplate | null,
  card: Card,
  side: 'front' | 'back',
): CardFaceContent {
  const fieldValues = card.field_values
  const allValues = Object.values(fieldValues)
  const fields = template?.fields ?? []

  // Get layout for the requested side
  const rawLayout = side === 'front'
    ? (template?.front_layout ?? [])
    : (template?.back_layout ?? [])

  // Filter to only items whose field values are non-empty
  const effectiveLayout = rawLayout.filter((item) => {
    const value = fieldValues[item.field_key]
    return value !== undefined && value !== ''
  })

  // Compute fallback value (used when effectiveLayout is empty)
  const fallbackIndex = side === 'front' ? 0 : Math.min(1, allValues.length - 1)
  const fallbackValue = allValues.length > 0
    ? (allValues[fallbackIndex] ?? '')
    : ''

  // Primary value: first effective layout item's value, or fallback
  let primaryValue: string
  if (effectiveLayout.length > 0) {
    primaryValue = fieldValues[effectiveLayout[0].field_key] ?? ''
  } else {
    primaryValue = fallbackValue
  }

  return {
    effectiveLayout,
    primaryValue,
    fallbackValue,
    fields,
    fieldValues,
  }
}
