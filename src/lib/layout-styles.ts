/**
 * ═══════════════════════════════════════════════════════
 * layout-styles.ts — Default layout styling for study cards
 *
 * Maps LayoutItem style + optional font_size to:
 *   - className: Tailwind CSS classes (color, weight, etc.)
 *   - fontSize: pixel value for inline style
 *
 * Pure functions, no side effects, fully testable.
 * ═══════════════════════════════════════════════════════
 */

import type { LayoutItem } from '../types/database'

export type StyleName = LayoutItem['style']

export interface LayoutItemStyleResult {
  className: string
  fontSize: number
}

/**
 * Available font size options for the template editor.
 * Each option has a pixel value and a human-readable label.
 */
export const FONT_SIZE_OPTIONS: { value: number; label: string }[] = [
  { value: 12, label: '12px (아주 작게)' },
  { value: 14, label: '14px (작게)' },
  { value: 16, label: '16px (기본)' },
  { value: 18, label: '18px' },
  { value: 20, label: '20px' },
  { value: 24, label: '24px (중간)' },
  { value: 28, label: '28px' },
  { value: 32, label: '32px (크게)' },
  { value: 40, label: '40px' },
  { value: 48, label: '48px (아주 크게)' },
  { value: 56, label: '56px' },
  { value: 64, label: '64px (최대)' },
]

/**
 * Default font sizes per style. Used when no custom font_size is set.
 * Designed for comfortable studying with clear visual hierarchy.
 */
export const DEFAULT_FONT_SIZES: Record<StyleName, number> = {
  primary: 40,
  secondary: 24,
  hint: 16,
  detail: 16,
  media: 16,
}

/**
 * Style definitions: className (Tailwind classes excluding font-size)
 * per layout style. Font size is handled separately via inline style.
 */
const STYLE_CLASSES: Record<StyleName, string> = {
  primary: 'font-bold text-gray-900 tracking-tight',
  secondary: 'font-semibold text-gray-700',
  hint: 'italic text-gray-400 border-l-2 border-gray-200 pl-3',
  detail: 'text-gray-600 leading-relaxed',
  media: 'text-gray-600',
}

/**
 * Get styling info for a layout item.
 *
 * @param style     — The layout style name (primary, secondary, etc.)
 * @param fontSize  — Optional custom font size in px. Falls back to DEFAULT_FONT_SIZES.
 * @returns         — { className, fontSize } for rendering
 */
export function getLayoutItemStyle(
  style: StyleName,
  fontSize?: number,
): LayoutItemStyleResult {
  const cls = STYLE_CLASSES[style] ?? STYLE_CLASSES.primary
  const size = fontSize ?? DEFAULT_FONT_SIZES[style] ?? DEFAULT_FONT_SIZES.primary

  return {
    className: cls,
    fontSize: size,
  }
}
