/**
 * ═══════════════════════════════════════════════════════
 * card-renderer.ts — Card face rendering decision logic
 *
 * Determines whether a card face should use default layout
 * or custom HTML rendering, and produces the rendered HTML
 * when in custom mode.
 *
 * Pure function, no side effects, fully testable.
 * ═══════════════════════════════════════════════════════
 */

import { renderCustomHTML } from './template-renderer'
import type { Card, CardTemplate } from '../types/database'

export type CardFaceResult =
  | { mode: 'default'; html?: undefined }
  | { mode: 'custom'; html: string }

/**
 * Determine how to render a card face (front or back).
 *
 * @param template — The card template (may be null)
 * @param card     — The card with field values
 * @param side     — 'front' or 'back'
 * @returns        — { mode: 'default' } or { mode: 'custom', html }
 *
 * Custom mode is only used when ALL conditions are met:
 *   1. template is not null
 *   2. template.layout_mode === 'custom'
 *   3. The HTML template for the requested side is non-empty (after trim)
 *
 * Otherwise, default layout mode is used.
 */
export function renderCardFace(
  template: CardTemplate | null,
  card: Card,
  side: 'front' | 'back',
): CardFaceResult {
  // No template → default
  if (!template) return { mode: 'default' }

  // Only treat as custom if layout_mode is strictly 'custom'
  if (template.layout_mode !== 'custom') return { mode: 'default' }

  // Pick the HTML template for the requested side
  const htmlTemplate = side === 'front' ? template.front_html : template.back_html

  // Empty or whitespace-only → fallback to default for this side
  if (!htmlTemplate || !htmlTemplate.trim()) return { mode: 'default' }

  // Render the custom HTML with field value substitution
  const html = renderCustomHTML(
    htmlTemplate,
    card.field_values,
    template.fields.map((f) => ({ key: f.key, name: f.name })),
  )

  return { mode: 'custom', html }
}
