/**
 * Unit tests for card-face text attribute logic.
 * Run with: npx tsx src/utils/card-text-style.test.ts
 *
 * Covers the real regression surface: CJK detection (which drives the iOS
 * lineHeight fix) and per-style typography. CJK sample strings are built from
 * code points so the source carries no literal CJK glyphs.
 */
import {
  computeCardTextAttrs,
  CJK_LINE_HEIGHT_RATIO,
  DEFAULT_LINE_HEIGHT_RATIO,
} from './card-text-style'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const HIRAGANA = String.fromCharCode(0x3042) // あ
const HAN = String.fromCharCode(0x4e2d)      // 中
const HANGUL = String.fromCharCode(0xac00)   // 가 (excluded from CJK ratio)
const KATAKANA = String.fromCharCode(0x30ab) // カ

// ── CJK detection ──
check('detects Hiragana as CJK', computeCardTextAttrs(HIRAGANA, 'primary', 40).isCJK)
check('detects Han as CJK', computeCardTextAttrs(HAN, 'primary', 40).isCJK)
check('detects Katakana as CJK', computeCardTextAttrs(KATAKANA, 'primary', 40).isCJK)
check('detects CJK mixed with ASCII', computeCardTextAttrs('word ' + HAN, 'primary', 40).isCJK)
check('plain ASCII is NOT CJK', !computeCardTextAttrs('Hello world', 'primary', 40).isCJK)
check('Hangul is NOT treated as CJK (renders fine at 1.5x)',
  !computeCardTextAttrs(HANGUL, 'primary', 40).isCJK)
check('empty string is NOT CJK', !computeCardTextAttrs('', 'primary', 40).isCJK)

// ── lineHeight ratio (the actual iOS clipping fix) ──
check('CJK lineHeight = 1.8x',
  computeCardTextAttrs(HAN, 'primary', 40).lineHeight === 40 * CJK_LINE_HEIGHT_RATIO)
check('non-CJK lineHeight = 1.5x',
  computeCardTextAttrs('abc', 'primary', 40).lineHeight === 40 * DEFAULT_LINE_HEIGHT_RATIO)
check('lineHeight scales with fontSize',
  computeCardTextAttrs('abc', 'secondary', 24).lineHeight === 24 * DEFAULT_LINE_HEIGHT_RATIO)

// ── weight / style / color ──
check('primary is bold', computeCardTextAttrs('a', 'primary', 40).fontWeight === '700')
check('secondary is bold', computeCardTextAttrs('a', 'secondary', 24).fontWeight === '700')
check('hint is not bold', computeCardTextAttrs('a', 'hint', 16).fontWeight === '400')
check('detail is not bold', computeCardTextAttrs('a', 'detail', 16).fontWeight === '400')
check('hint is italic', computeCardTextAttrs('a', 'hint', 16).fontStyle === 'italic')
check('primary is not italic', computeCardTextAttrs('a', 'primary', 40).fontStyle === 'normal')
check('hint uses secondary color', computeCardTextAttrs('a', 'hint', 16).isSecondaryColor)
check('detail uses secondary color', computeCardTextAttrs('a', 'detail', 16).isSecondaryColor)
check('primary uses primary color', !computeCardTextAttrs('a', 'primary', 40).isSecondaryColor)

console.log(`\ncard-text-style: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
