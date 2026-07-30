import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/locale-utils'

// Node 22+ ships its own `localStorage`/`sessionStorage` global that is only
// usable with --localstorage-file, and it shadows jsdom's: on Node 26 every bare
// `localStorage.…` in a test read `undefined`, failing 21 tests. CI (Node 20) has
// no such global, which is why the breakage was local-only. Install a minimal
// in-memory Storage when the runtime's own is unusable so the suite behaves the
// same everywhere.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number { return this.store.size }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null }
  getItem(key: string): string | null { return this.store.get(String(key)) ?? null }
  setItem(key: string, value: string): void { this.store.set(String(key), String(value)) }
  removeItem(key: string): void { this.store.delete(String(key)) }
  clear(): void { this.store.clear() }
}

function isUsableStorage(candidate: unknown): boolean {
  try {
    return typeof (candidate as Storage | undefined)?.setItem === 'function'
  } catch {
    // Node's getter throws when the backing file is absent.
    return false
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let current: unknown
  try { current = globalThis[name] } catch { current = undefined }
  if (isUsableStorage(current)) continue
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, name, { configurable: true, get: () => storage })
  if (typeof window !== 'undefined' && window !== (globalThis as unknown)) {
    Object.defineProperty(window, name, { configurable: true, get: () => storage })
  }
}

// Mock window.matchMedia for hooks using media queries (e.g. useReducedMotion)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock IntersectionObserver for framer-motion's whileInView
globalThis.IntersectionObserver = class {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  observe() { return }
  unobserve() { return }
  disconnect() { return }
  takeRecords(): IntersectionObserverEntry[] { return [] }
} as unknown as typeof IntersectionObserver

i18n.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  ns: ['common', 'auth', 'errors', 'dashboard', 'study', 'decks', 'cards', 'templates', 'settings', 'marketplace', 'sharing', 'import-export', 'history', 'guide', 'landing', 'wallet'],
  defaultNS: 'common',
  resources: { [DEFAULT_LOCALE]: {} },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})
