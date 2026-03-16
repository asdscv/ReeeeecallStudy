import { useColorScheme } from 'react-native'
import { createContext, useContext } from 'react'
import { lightColors, darkColors, type ThemeColors } from './colors'
import { spacing, borderRadius } from './spacing'
import { typography } from './typography'

export { palette } from './colors'
export { spacing, borderRadius } from './spacing'
export { typography } from './typography'

export interface Theme {
  colors: ThemeColors
  spacing: typeof spacing
  borderRadius: typeof borderRadius
  typography: typeof typography
  isDark: boolean
}

export function createTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? darkColors : lightColors,
    spacing,
    borderRadius,
    typography,
    isDark,
  }
}

// Context
const ThemeContext = createContext<Theme>(createTheme(false))

export const ThemeProvider = ThemeContext.Provider

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function useAppTheme(): Theme {
  const colorScheme = useColorScheme()
  return createTheme(colorScheme === 'dark')
}
