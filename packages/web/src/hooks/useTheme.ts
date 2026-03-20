import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'

export type ThemePreference = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

interface UseThemeReturn {
  /** User's stored preference ('light' | 'dark' | 'system') */
  theme: ThemePreference
  /** Resolved theme after evaluating system preference ('light' | 'dark') */
  effectiveTheme: EffectiveTheme
  /** Update theme preference — persists to profile if logged in */
  setTheme: (theme: ThemePreference) => Promise<void>
}

const STORAGE_KEY = 'reeeeecall-theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

/**
 * Reads the initial theme preference from localStorage (fast, sync).
 * Falls back to 'system' if nothing stored.
 */
function getStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // Private browsing or storage unavailable
  }
  return 'system'
}

/** Resolve system preference */
function getSystemPreference(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
}

/** Apply the dark class to <html> and update <meta name="color-scheme"> */
function applyThemeToDOM(effective: EffectiveTheme) {
  const root = document.documentElement
  if (effective === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  // Update color-scheme for native form controls, scrollbars, etc.
  root.style.colorScheme = effective
}

/**
 * Enterprise-grade theme hook.
 *
 * Priority chain:
 * 1. Profile `theme` field from DB (synced on login)
 * 2. localStorage cache (instant, avoids flash)
 * 3. System preference via matchMedia
 *
 * Applies `dark` class to document.documentElement for CSS variable switching.
 */
export function useTheme(): UseThemeReturn {
  const user = useAuthStore((s) => s.user)
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme)
  const [systemPreference, setSystemPreference] = useState<EffectiveTheme>(getSystemPreference)

  const effectiveTheme = useMemo(
    () => (theme === 'system' ? systemPreference : theme),
    [theme, systemPreference],
  )

  // Apply theme to DOM whenever effective theme changes
  useEffect(() => {
    applyThemeToDOM(effectiveTheme)
  }, [effectiveTheme])

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia(MEDIA_QUERY)
    const handler = (e: MediaQueryListEvent) => {
      setSystemPreference(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Load theme from profile on login
  useEffect(() => {
    if (!user) return
    let cancelled = false

    const loadProfileTheme = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('theme')
          .eq('id', user.id)
          .single()

        if (cancelled) return
        const profileTheme = data?.theme as ThemePreference | null | undefined
        if (profileTheme && (profileTheme === 'light' || profileTheme === 'dark' || profileTheme === 'system')) {
          setThemeState(profileTheme)
          try {
            localStorage.setItem(STORAGE_KEY, profileTheme)
          } catch { /* ignore */ }
        }
      } catch {
        // Network error — keep localStorage value
      }
    }

    loadProfileTheme()
    return () => { cancelled = true }
  }, [user])

  const setTheme = useCallback(async (newTheme: ThemePreference) => {
    setThemeState(newTheme)

    // Persist to localStorage immediately (avoids flash on next load)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch { /* ignore */ }

    // Persist to profile if logged in
    if (user) {
      try {
        await supabase
          .from('profiles')
          .update({ theme: newTheme } as Record<string, unknown>)
          .eq('id', user.id)
      } catch {
        // Silently fail — localStorage is the fallback
      }
    }
  }, [user])

  return { theme, effectiveTheme, setTheme }
}
