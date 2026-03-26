/**
 * Design tokens — Colors
 * Imports shared palette and themes, extends with mobile-specific properties.
 */
import {
  palette as sharedPalette,
  lightTheme,
  darkTheme,
} from '@reeeeecall/shared/design-tokens/colors'

// Re-export shared palette with mobile-only additions
export const palette = {
  ...sharedPalette,
  transparent: 'transparent',
} as const

export interface ThemeColors {
  background: string
  surface: string
  surfaceElevated: string
  text: string
  textSecondary: string
  textTertiary: string
  textInverse: string
  primary: string
  primaryLight: string
  primaryText: string
  border: string
  borderFocused: string
  error: string
  errorLight: string
  success: string
  successLight: string
  warning: string
  buttonPrimary: string
  buttonPrimaryPressed: string
  buttonSecondary: string
  buttonSecondaryPressed: string
  buttonDisabled: string
  inputBackground: string
  inputBorder: string
  inputPlaceholder: string
  overlay: string
  google: string
  apple: string
}

export type LightThemeColors = ThemeColors

export const lightColors: ThemeColors = {
  // Backgrounds — mobile uses gray-50 as main background (not white like web)
  background: palette.gray[50],
  surface: lightTheme.surface,
  surfaceElevated: lightTheme.surfaceElevated,
  // Text
  text: lightTheme.text,
  textSecondary: lightTheme.textSecondary,
  textTertiary: lightTheme.textTertiary,
  textInverse: lightTheme.textInverse,
  // Brand
  primary: lightTheme.primary,
  primaryLight: lightTheme.primaryLight,
  primaryText: lightTheme.primaryText,
  // Borders — shared uses borderFocus, mobile uses borderFocused
  border: lightTheme.border,
  borderFocused: lightTheme.borderFocus,
  // Semantic
  error: lightTheme.error,
  errorLight: lightTheme.errorLight,
  success: lightTheme.success,
  successLight: lightTheme.successLight,
  warning: lightTheme.warning,
  // Interactive
  buttonPrimary: lightTheme.buttonPrimary,
  buttonPrimaryPressed: lightTheme.buttonPrimaryPressed,
  buttonSecondary: lightTheme.buttonSecondary,
  buttonSecondaryPressed: lightTheme.buttonSecondaryPressed,
  buttonDisabled: lightTheme.buttonDisabled,
  // Input
  inputBackground: lightTheme.inputBackground,
  inputBorder: lightTheme.inputBorder,
  inputPlaceholder: lightTheme.inputPlaceholder,
  // Overlay
  overlay: lightTheme.overlay,
  // Social (mobile-only)
  google: '#4285F4',
  apple: palette.black,
} as const

export const darkColors: ThemeColors = {
  // All values from shared darkTheme — single source of truth
  background: darkTheme.background,
  surface: darkTheme.surface,
  surfaceElevated: darkTheme.surfaceElevated,
  text: darkTheme.text,
  textSecondary: darkTheme.textSecondary,
  textTertiary: darkTheme.textTertiary,
  textInverse: darkTheme.textInverse,
  primary: darkTheme.primary,
  primaryLight: darkTheme.primaryLight,
  primaryText: darkTheme.primaryText,
  border: darkTheme.border,
  borderFocused: darkTheme.borderFocus,
  error: darkTheme.error,
  errorLight: darkTheme.errorLight,
  success: darkTheme.success,
  successLight: darkTheme.successLight,
  warning: darkTheme.warning,
  buttonPrimary: darkTheme.buttonPrimary,
  buttonPrimaryPressed: darkTheme.buttonPrimaryPressed,
  buttonSecondary: darkTheme.buttonSecondary,
  buttonSecondaryPressed: darkTheme.buttonSecondaryPressed,
  buttonDisabled: darkTheme.buttonDisabled,
  inputBackground: darkTheme.inputBackground,
  inputBorder: darkTheme.inputBorder,
  inputPlaceholder: darkTheme.inputPlaceholder,
  overlay: darkTheme.overlay,
  // Social (mobile-only)
  google: '#4285F4',
  apple: palette.white,
} as const
