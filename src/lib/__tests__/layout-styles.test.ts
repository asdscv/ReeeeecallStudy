import { describe, it, expect } from 'vitest'
import {
  getLayoutItemStyle,
  FONT_SIZE_OPTIONS,
  DEFAULT_FONT_SIZES,
} from '../layout-styles'

// ═══════════════════════════════════════════════════════
// FONT_SIZE_OPTIONS
// ═══════════════════════════════════════════════════════

describe('FONT_SIZE_OPTIONS', () => {
  it('should have at least 5 size options', () => {
    expect(FONT_SIZE_OPTIONS.length).toBeGreaterThanOrEqual(5)
  })

  it('should be sorted ascending', () => {
    for (let i = 1; i < FONT_SIZE_OPTIONS.length; i++) {
      expect(FONT_SIZE_OPTIONS[i].value).toBeGreaterThan(FONT_SIZE_OPTIONS[i - 1].value)
    }
  })

  it('each option should have value and label', () => {
    for (const opt of FONT_SIZE_OPTIONS) {
      expect(opt.value).toBeGreaterThan(0)
      expect(opt.label).toBeTruthy()
    }
  })
})

// ═══════════════════════════════════════════════════════
// DEFAULT_FONT_SIZES
// ═══════════════════════════════════════════════════════

describe('DEFAULT_FONT_SIZES', () => {
  it('should have a default size for each style', () => {
    expect(DEFAULT_FONT_SIZES.primary).toBeGreaterThan(0)
    expect(DEFAULT_FONT_SIZES.secondary).toBeGreaterThan(0)
    expect(DEFAULT_FONT_SIZES.hint).toBeGreaterThan(0)
    expect(DEFAULT_FONT_SIZES.detail).toBeGreaterThan(0)
    expect(DEFAULT_FONT_SIZES.media).toBeGreaterThan(0)
  })

  it('primary should be the largest', () => {
    expect(DEFAULT_FONT_SIZES.primary).toBeGreaterThan(DEFAULT_FONT_SIZES.secondary)
    expect(DEFAULT_FONT_SIZES.secondary).toBeGreaterThan(DEFAULT_FONT_SIZES.hint)
  })
})

// ═══════════════════════════════════════════════════════
// getLayoutItemStyle
// ═══════════════════════════════════════════════════════

describe('getLayoutItemStyle', () => {
  it('should return className and fontSize for primary style', () => {
    const result = getLayoutItemStyle('primary')
    expect(result.className).toContain('font-bold')
    expect(result.className).toContain('text-gray-900')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.primary)
  })

  it('should return className for secondary style', () => {
    const result = getLayoutItemStyle('secondary')
    expect(result.className).toContain('font-semibold')
    expect(result.className).toContain('text-gray-700')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.secondary)
  })

  it('should return className for hint style', () => {
    const result = getLayoutItemStyle('hint')
    expect(result.className).toContain('italic')
    expect(result.className).toContain('text-gray-400')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.hint)
  })

  it('should return className for detail style', () => {
    const result = getLayoutItemStyle('detail')
    expect(result.className).toContain('text-gray-600')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.detail)
  })

  it('should return className for media style', () => {
    const result = getLayoutItemStyle('media')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.media)
  })

  it('should override fontSize when custom font_size is provided', () => {
    const result = getLayoutItemStyle('primary', 24)
    expect(result.fontSize).toBe(24)
    expect(result.className).toContain('font-bold')
  })

  it('should use default fontSize when font_size is undefined', () => {
    const result = getLayoutItemStyle('secondary', undefined)
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.secondary)
  })

  it('should fallback to primary style for unknown style', () => {
    const result = getLayoutItemStyle('unknown_style' as any)
    expect(result.className).toContain('font-bold')
    expect(result.fontSize).toBe(DEFAULT_FONT_SIZES.primary)
  })

  it('should return different classNames for different styles', () => {
    const primary = getLayoutItemStyle('primary')
    const hint = getLayoutItemStyle('hint')
    expect(primary.className).not.toBe(hint.className)
  })

  it('hint should have border-left or distinct visual separator', () => {
    const result = getLayoutItemStyle('hint')
    // Hint style should have visual differentiation (border or background)
    expect(
      result.className.includes('border-l') ||
      result.className.includes('bg-') ||
      result.className.includes('italic')
    ).toBe(true)
  })

  it('detail should have leading-relaxed for readability', () => {
    const result = getLayoutItemStyle('detail')
    expect(result.className).toContain('leading-relaxed')
  })
})
