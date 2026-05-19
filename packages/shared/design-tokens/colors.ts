/**
 * Shared Design Tokens — Colors
 * Single source of truth for Web & Mobile color values.
 */

export const palette = {
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
    950: '#172554',
  },
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
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
  },
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
  },
  yellow: {
    50: '#FFFBEB',
    100: '#FEF3C7',
    400: '#FACC15',
    500: '#EAB308',
    600: '#CA8A04',
    700: '#A16207',
  },
  purple: {
    50: '#FAF5FF',
    100: '#F3E8FF',
    200: '#E9D5FF',
    300: '#D8B4FE',
    500: '#A855F7',
    600: '#9333EA',
    700: '#7C3AED',
  },
  white: '#FFFFFF',
  black: '#000000',
} as const

export const lightTheme = {
  // Brand
  primary: palette.blue[600],
  primaryLight: palette.blue[50],
  primaryText: palette.white,

  // Background
  background: palette.white,
  backgroundSecondary: palette.gray[50],
  surface: palette.gray[100],
  surfaceElevated: palette.white,

  // Text
  text: palette.gray[900],
  textSecondary: palette.gray[500],
  textTertiary: palette.gray[400],
  textInverse: palette.white,

  // Border
  border: palette.gray[200],
  borderSecondary: palette.gray[300],
  borderFocus: palette.blue[500],

  // Semantic
  error: palette.red[500],
  errorLight: palette.red[50],
  success: palette.green[500],
  successLight: palette.green[50],
  warning: palette.yellow[500],
  warningLight: palette.yellow[50],

  // Input
  inputBackground: palette.white,
  inputBorder: palette.gray[300],
  inputPlaceholder: palette.gray[400],

  // Button
  buttonPrimary: palette.blue[600],
  buttonPrimaryPressed: palette.blue[700],
  buttonSecondary: palette.gray[100],
  buttonSecondaryPressed: palette.gray[200],
  buttonDisabled: palette.gray[200],
  buttonDisabledText: palette.gray[400],

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const

export const darkTheme = {
  // Brand
  primary: palette.blue[400],
  primaryLight: 'rgba(59, 130, 246, 0.15)',
  primaryText: palette.white,

  // Background
  background: palette.gray[950],
  backgroundSecondary: palette.gray[900],
  surface: palette.gray[800],
  surfaceElevated: palette.gray[800],

  // Text
  text: palette.gray[50],
  textSecondary: palette.gray[400],
  textTertiary: palette.gray[500],
  textInverse: palette.gray[900],

  // Border
  border: palette.gray[800],
  borderSecondary: palette.gray[700],
  borderFocus: palette.blue[500],

  // Semantic
  error: palette.red[400],
  errorLight: 'rgba(239, 68, 68, 0.15)',
  success: palette.green[400],
  successLight: 'rgba(34, 197, 94, 0.15)',
  warning: palette.yellow[400],
  warningLight: 'rgba(234, 179, 8, 0.15)',

  // Input
  inputBackground: palette.gray[900],
  inputBorder: palette.gray[700],
  inputPlaceholder: palette.gray[500],

  // Button
  buttonPrimary: palette.blue[500],
  buttonPrimaryPressed: palette.blue[600],
  buttonSecondary: palette.gray[800],
  buttonSecondaryPressed: palette.gray[700],
  buttonDisabled: palette.gray[800],
  buttonDisabledText: palette.gray[600],

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.7)',
} as const

export type ThemeColors = typeof lightTheme

/**
 * SRS Rating colors — used consistently across web & mobile
 * for rating buttons, distribution charts, and session details.
 */
export const ratingColors = {
  again: palette.red[500],     // #EF4444
  hard: palette.yellow[500],   // #EAB308  (web uses amber, unified to yellow-500)
  good: palette.green[500],    // #22C55E
  easy: palette.blue[500],     // #3B82F6
  againLight: palette.red[50],
  hardLight: palette.yellow[50],
  goodLight: palette.green[50],
  easyLight: palette.blue[50],
} as const

/**
 * Status colors — for share states, badges, etc.
 */
export const statusColors = {
  pending: { bg: palette.yellow[50], text: '#B45309' },
  active: { bg: palette.green[50], text: palette.green[700] },
  revoked: { bg: palette.red[50], text: palette.red[600] },
  declined: { bg: palette.gray[100], text: palette.gray[500] },
} as const
