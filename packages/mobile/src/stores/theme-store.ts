import { create } from 'zustand'
import { Appearance } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { toAppearanceColorScheme, type ThemeMode } from '../utils/color-scheme'

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
    // Appearance API — 네이티브 컴포넌트 동기화.
    // system은 'unspecified'로 전달해야 OS 설정을 따름 (이 RN 버전의 ColorSchemeName은
    // 'light'|'dark'|'unspecified' — null 아님). null은 타입·런타임 모두 부정확.
    Appearance.setColorScheme(toAppearanceColorScheme(theme))
  },
}))
