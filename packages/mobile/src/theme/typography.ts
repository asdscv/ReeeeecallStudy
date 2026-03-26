import { Platform, type TextStyle } from 'react-native'
import {
  textStyles,
  fontSize,
  fontWeight,
  lineHeight,
} from '@reeeeecall/shared/design-tokens/typography'

/**
 * Design tokens — Typography
 * Uses shared text styles with platform-specific font families.
 * iOS: SF Pro (System), Android: Roboto
 */
const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
})

export const typography = {
  // Display — h1 uses 32 on mobile (shared uses 30) for larger screens
  h1: {
    fontFamily,
    fontSize: 32,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight['4xl'],
    letterSpacing: -0.5,
  } satisfies TextStyle,

  h2: {
    fontFamily,
    fontSize: textStyles.h2.fontSize,
    fontWeight: fontWeight.bold,
    lineHeight: textStyles.h2.lineHeight,
    letterSpacing: -0.3,
  } satisfies TextStyle,

  h3: {
    fontFamily,
    fontSize: textStyles.h3.fontSize,
    fontWeight: fontWeight.semibold,
    lineHeight: textStyles.h3.lineHeight,
  } satisfies TextStyle,

  // Body — uses shared base (16) instead of old 15
  bodyLarge: {
    fontFamily,
    fontSize: textStyles.bodyLarge.fontSize,
    fontWeight: fontWeight.normal,
    lineHeight: textStyles.bodyLarge.lineHeight,
  } satisfies TextStyle,

  body: {
    fontFamily,
    fontSize: textStyles.body.fontSize,
    fontWeight: fontWeight.normal,
    lineHeight: textStyles.body.lineHeight,
  } satisfies TextStyle,

  bodySmall: {
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.sm,
  } satisfies TextStyle,

  // Labels — uses shared medium (500) instead of old semibold (600)
  label: {
    fontFamily,
    fontSize: textStyles.label.fontSize,
    fontWeight: fontWeight.medium,
    lineHeight: textStyles.label.lineHeight,
  } satisfies TextStyle,

  labelSmall: {
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.xs,
  } satisfies TextStyle,

  // Caption
  caption: {
    fontFamily,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.xs,
  } satisfies TextStyle,

  // Button
  button: {
    fontFamily,
    fontSize: textStyles.button.fontSize,
    fontWeight: fontWeight.semibold,
    lineHeight: textStyles.button.lineHeight,
  } satisfies TextStyle,

  buttonSmall: {
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.sm,
  } satisfies TextStyle,
} as const

export type TypographyVariant = keyof typeof typography
