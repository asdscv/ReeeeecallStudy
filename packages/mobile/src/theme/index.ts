import { useColorScheme } from 'react-native'
import { createContext, useContext } from 'react'
import { lightColors, darkColors, type ThemeColors } from './colors'
import { spacing, borderRadius } from './spacing'
import { typography } from './typography'
import { useThemeStore } from '../stores/theme-store'

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

/**
 * 앱 전체 테마 결정.
 *
 * 우선순위:
 *   1) useThemeStore().userTheme (Zustand — prefetch가 스플래시 중에 DB에서 로드)
 *   2) useColorScheme() (OS 설정 fallback)
 *
 * Zustand store는 React 상태이므로 setUserTheme() 호출 시
 * 이 훅을 사용하는 모든 컴포넌트(AppContent 포함)가 자동 재렌더.
 * Appearance.setColorScheme()만으로는 재렌더가 보장되지 않아서
 * 이 방식이 확실하게 동작.
 */
export function useAppTheme(): Theme {
  const colorScheme = useColorScheme()
  const userTheme = useThemeStore((s) => s.userTheme)

  let isDark: boolean
  if (userTheme === 'light') {
    isDark = false
  } else if (userTheme === 'dark') {
    isDark = true
  } else {
    // 'system' 또는 null(아직 로드 안 됨) → OS 설정 따름
    isDark = colorScheme === 'dark'
  }

  return createTheme(isDark)
}
