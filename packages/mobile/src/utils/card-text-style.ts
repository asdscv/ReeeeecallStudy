/**
 * Card-face text attributes — PURE (no RN imports), so it's unit-testable and
 * shared by the study card renderer.
 *
 * Only the layout/typography decisions live here; the consumer applies
 * theme-derived `color` and `textAlign`.
 */

// CJK Han / Hiragana / Katakana need extra lineHeight on iOS — PingFang/HiraKaku
// glyph ascent exceeds 1.5x at large sizes and clips the top stroke. Hangul
// (U+AC00-U+D7AF) is intentionally excluded; it renders fine at 1.5x.
// Built from an ASCII escape string so the source carries no literal CJK glyphs.
//   3040-30FF Hiragana/Katakana · 3400-4DBF CJK Ext-A
//   4E00-9FFF CJK Unified       · F900-FAFF CJK Compatibility
export const CJK_RE = new RegExp('[\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]')

export const CJK_LINE_HEIGHT_RATIO = 1.8
export const DEFAULT_LINE_HEIGHT_RATIO = 1.5

export interface CardTextAttrs {
  fontSize: number
  fontWeight: '700' | '400'
  fontStyle: 'italic' | 'normal'
  lineHeight: number
  /** Whether the value contains CJK glyphs (drives the lineHeight ratio). */
  isCJK: boolean
  /** True for `hint`/`detail` styles -> consumer uses textSecondary color. */
  isSecondaryColor: boolean
}

/**
 * Compute typography attributes for a card field.
 * @param value    field text (used for CJK detection)
 * @param style    layout style key (`primary`|`secondary`|`hint`|`detail`|...)
 * @param fontSize already-resolved font size in px
 */
export function computeCardTextAttrs(
  value: string,
  style: string,
  fontSize: number,
): CardTextAttrs {
  const isBold = style === 'primary' || style === 'secondary'
  const isHint = style === 'hint'
  const isDetail = style === 'detail'
  const isCJK = CJK_RE.test(value)

  return {
    fontSize,
    fontWeight: isBold ? '700' : '400',
    fontStyle: isHint ? 'italic' : 'normal',
    lineHeight: fontSize * (isCJK ? CJK_LINE_HEIGHT_RATIO : DEFAULT_LINE_HEIGHT_RATIO),
    isCJK,
    isSecondaryColor: isHint || isDetail,
  }
}
