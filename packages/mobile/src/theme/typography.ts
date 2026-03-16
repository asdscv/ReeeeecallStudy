import { Platform, type TextStyle } from 'react-native'

/**
 * Design tokens — Typography
 * iOS: SF Pro, Android: Roboto (system defaults)
 */
const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
})

export const typography = {
  // Display
  h1: {
    fontFamily,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.5,
  } satisfies TextStyle,

  h2: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: -0.3,
  } satisfies TextStyle,

  h3: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  } satisfies TextStyle,

  // Body
  bodyLarge: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 24,
  } satisfies TextStyle,

  body: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
  } satisfies TextStyle,

  bodySmall: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  } satisfies TextStyle,

  // Labels
  label: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  } satisfies TextStyle,

  labelSmall: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  } satisfies TextStyle,

  // Caption
  caption: {
    fontFamily,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  } satisfies TextStyle,

  // Button
  button: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  } satisfies TextStyle,

  buttonSmall: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  } satisfies TextStyle,
} as const

export type TypographyVariant = keyof typeof typography
