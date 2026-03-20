import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock supabase before importing useTheme
const mockSupabaseFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}))

// Mock auth store
const mockUser = { id: 'user-123', email: 'test@example.com' }
let mockUserState: typeof mockUser | null = null
vi.mock('../../stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: typeof mockUser | null }) => unknown) =>
    selector({ user: mockUserState }),
}))

import { useTheme } from '../useTheme'

describe('useTheme', () => {
  let matchMediaListeners: Map<string, (e: MediaQueryListEvent) => void>
  let mockMatches: boolean

  beforeEach(() => {
    // Reset DOM
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
    localStorage.clear()

    // Reset mock user
    mockUserState = null

    // Mock matchMedia
    mockMatches = false
    matchMediaListeners = new Map()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: mockMatches,
        media: query,
        onchange: null,
        addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners.set(query, handler)
        },
        removeEventListener: (_event: string, _handler: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners.delete(query)
        },
        dispatchEvent: vi.fn(),
      })),
    })

    // Mock supabase responses
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { theme: null }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('default behavior', () => {
    it('defaults to system theme when nothing stored', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBe('system')
    })

    it('resolves effectiveTheme to light when system prefers light', () => {
      mockMatches = false // prefers-color-scheme: dark = false → light
      const { result } = renderHook(() => useTheme())

      expect(result.current.effectiveTheme).toBe('light')
    })

    it('resolves effectiveTheme to dark when system prefers dark', () => {
      mockMatches = true // prefers-color-scheme: dark = true
      const { result } = renderHook(() => useTheme())

      // theme is 'system', system says dark
      expect(result.current.theme).toBe('system')
      expect(result.current.effectiveTheme).toBe('dark')
    })
  })

  describe('localStorage integration', () => {
    it('reads stored theme from localStorage', () => {
      localStorage.setItem('reeeeecall-theme', 'dark')
      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBe('dark')
      expect(result.current.effectiveTheme).toBe('dark')
    })

    it('ignores invalid stored values and defaults to system', () => {
      localStorage.setItem('reeeeecall-theme', 'neon-pink')
      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBe('system')
    })

    it('persists theme to localStorage on change', async () => {
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(localStorage.getItem('reeeeecall-theme')).toBe('dark')
    })
  })

  describe('dark class on documentElement', () => {
    it('applies dark class when theme is dark', async () => {
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('removes dark class when theme is light', async () => {
      // Start dark
      localStorage.setItem('reeeeecall-theme', 'dark')
      const { result } = renderHook(() => useTheme())

      expect(document.documentElement.classList.contains('dark')).toBe(true)

      await act(async () => {
        await result.current.setTheme('light')
      })

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('sets color-scheme CSS property', async () => {
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(document.documentElement.style.colorScheme).toBe('dark')
    })
  })

  describe('system preference detection', () => {
    it('reacts to system preference changes when theme is system', () => {
      mockMatches = false
      const { result } = renderHook(() => useTheme())

      expect(result.current.effectiveTheme).toBe('light')

      // Simulate system switching to dark
      act(() => {
        const listener = matchMediaListeners.get('(prefers-color-scheme: dark)')
        if (listener) {
          listener({ matches: true } as MediaQueryListEvent)
        }
      })

      expect(result.current.effectiveTheme).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('ignores system changes when theme is explicitly set', async () => {
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('light')
      })

      // Simulate system switching to dark
      act(() => {
        const listener = matchMediaListeners.get('(prefers-color-scheme: dark)')
        if (listener) {
          listener({ matches: true } as MediaQueryListEvent)
        }
      })

      // Should still be light because user explicitly chose light
      expect(result.current.effectiveTheme).toBe('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('theme change updates', () => {
    it('setTheme updates both theme and effectiveTheme', async () => {
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(result.current.theme).toBe('dark')
      expect(result.current.effectiveTheme).toBe('dark')

      await act(async () => {
        await result.current.setTheme('light')
      })

      expect(result.current.theme).toBe('light')
      expect(result.current.effectiveTheme).toBe('light')
    })

    it('switching to system resolves based on matchMedia', async () => {
      mockMatches = true
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('light')
      })
      expect(result.current.effectiveTheme).toBe('light')

      await act(async () => {
        await result.current.setTheme('system')
      })
      expect(result.current.theme).toBe('system')
      expect(result.current.effectiveTheme).toBe('dark')
    })
  })

  describe('profile persistence', () => {
    it('saves to supabase when user is logged in', async () => {
      mockUserState = mockUser
      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      expect(mockSupabaseFrom).toHaveBeenCalledWith('profiles')
    })

    it('does not call supabase when user is not logged in', async () => {
      mockUserState = null
      mockSupabaseFrom.mockClear()

      const { result } = renderHook(() => useTheme())

      await act(async () => {
        await result.current.setTheme('dark')
      })

      // Should not have been called for update (may still be called for initial profile load)
      // But since user is null, the profile load effect should not fire either
      expect(mockSupabaseFrom).not.toHaveBeenCalled()
    })
  })
})
