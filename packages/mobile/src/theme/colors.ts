/**
 * Design tokens — Colors
 * 확장 가능: 새 팔레트 추가 시 ColorPalette에 키 추가
 */

export const palette = {
  // Brand
  blue: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
  },
  // Neutrals
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#030712',
  },
  // Semantic
  red: { 50: '#FEF2F2', 100: '#FEE2E2', 400: '#F87171', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C' },
  green: { 50: '#F0FDF4', 400: '#4ADE80', 500: '#22C55E', 600: '#16A34A', 700: '#15803D' },
  yellow: { 400: '#FACC15', 500: '#EAB308', 600: '#CA8A04' },
  purple: { 50: '#FAF5FF', 200: '#E9D5FF', 600: '#9333EA', 700: '#7E22CE' },
  // Pure
  white: '#FFFFFF',
  black: '#000000',
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
  // Backgrounds — matches web: bg-gray-50 main, white cards
  background: palette.gray[50],
  surface: palette.gray[100],
  surfaceElevated: palette.white,
  // Text
  text: palette.gray[900],
  textSecondary: palette.gray[500],
  textTertiary: palette.gray[400],
  textInverse: palette.white,
  // Brand
  primary: palette.blue[600],
  primaryLight: palette.blue[50],
  primaryText: palette.white,
  // Borders
  border: palette.gray[200],
  borderFocused: palette.blue[500],
  // Semantic
  error: palette.red[500],
  errorLight: '#FEF2F2',
  success: palette.green[500],
  successLight: '#F0FDF4',
  warning: palette.yellow[500],
  // Interactive
  buttonPrimary: palette.blue[600],
  buttonPrimaryPressed: palette.blue[700],
  buttonSecondary: palette.gray[100],
  buttonSecondaryPressed: palette.gray[200],
  buttonDisabled: palette.gray[200],
  // Input
  inputBackground: palette.white,
  inputBorder: palette.gray[300],
  inputPlaceholder: palette.gray[400],
  // Overlay
  overlay: 'rgba(0,0,0,0.5)',
  // Social
  google: '#4285F4',
  apple: palette.black,
} as const

export const darkColors: ThemeColors = {
  background: palette.gray[950],
  surface: palette.gray[900],
  surfaceElevated: palette.gray[800],
  text: palette.gray[50],
  textSecondary: palette.gray[400],
  textTertiary: palette.gray[600],
  textInverse: palette.gray[900],
  primary: palette.blue[500],
  primaryLight: 'rgba(59,130,246,0.15)',
  primaryText: palette.white,
  border: palette.gray[800],
  borderFocused: palette.blue[500],
  error: palette.red[400],
  errorLight: 'rgba(239,68,68,0.15)',
  success: palette.green[400],
  successLight: 'rgba(34,197,94,0.15)',
  warning: palette.yellow[400],
  buttonPrimary: palette.blue[600],
  buttonPrimaryPressed: palette.blue[500],
  buttonSecondary: palette.gray[800],
  buttonSecondaryPressed: palette.gray[700],
  buttonDisabled: palette.gray[800],
  inputBackground: palette.gray[900],
  inputBorder: palette.gray[700],
  inputPlaceholder: palette.gray[600],
  overlay: 'rgba(0,0,0,0.7)',
  google: '#4285F4',
  apple: palette.white,
} as const
