import { create } from 'zustand'
import { Appearance } from 'react-native'
import * as SecureStore from 'expo-secure-store'

type ThemeMode = 'light' | 'dark' | 'system'

const THEME_CACHE_KEY = 'reeeeecall-user-theme'

interface ThemeState {
  /** DB에서 로드된 사용자 테마 설정. null이면 아직 로드 안 됨 → system 기본값 사용. */
  userTheme: ThemeMode | null
  setUserTheme: (theme: ThemeMode) => void
}

/**
 * 테마 전용 Zustand store + SecureStore 캐시.
 *
 * 3중 보장:
 *   1) SecureStore 캐시: initMobilePlatform()에서 동기적으로 읽어 React 전에 적용
 *   2) Zustand store: React 컴포넌트 재렌더 트리거
 *   3) Appearance API: 네이티브 UI(Alert, StatusBar 등) 동기화
 */
export const useThemeStore = create<ThemeState>((set) => ({
  userTheme: null,

  setUserTheme: (theme) => {
    set({ userTheme: theme })
    // SecureStore 캐시 — 다음 앱 시작 시 initMobilePlatform()에서 즉시 읽음
    try { SecureStore.setItem(THEME_CACHE_KEY, theme) } catch {}
    // Appearance API — 네이티브 컴포넌트 동기화
    Appearance.setColorScheme(theme === 'system' ? null : theme)
  },
}))
