/**
 * Shared Design Tokens — Typography
 * Unified font sizes, weights, and line heights.
 */

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
}

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
} as const

export const lineHeight = {
  xs: 16,
  sm: 20,
  base: 24,
  lg: 26,
  xl: 28,
  '2xl': 32,
  '3xl': 36,
  '4xl': 40,
} as const

export const textStyles = {
  h1: { fontSize: fontSize['3xl'], fontWeight: fontWeight.bold, lineHeight: lineHeight['4xl'] },
  h2: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, lineHeight: lineHeight['2xl'] },
  h3: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, lineHeight: lineHeight.xl },
  bodyLarge: { fontSize: fontSize.lg, fontWeight: fontWeight.normal, lineHeight: lineHeight.lg },
  body: { fontSize: fontSize.base, fontWeight: fontWeight.normal, lineHeight: lineHeight.base },
  bodySmall: { fontSize: fontSize.sm, fontWeight: fontWeight.normal, lineHeight: lineHeight.sm },
  label: { fontSize: fontSize.base, fontWeight: fontWeight.medium, lineHeight: lineHeight.sm },
  labelSmall: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, lineHeight: lineHeight.xs },
  caption: { fontSize: fontSize.xs, fontWeight: fontWeight.normal, lineHeight: lineHeight.xs },
  button: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, lineHeight: lineHeight.base },
  buttonSmall: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, lineHeight: lineHeight.sm },
} as const
