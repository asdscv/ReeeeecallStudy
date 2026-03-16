import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/locale-utils'

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
  ns: ['common', 'auth', 'errors', 'dashboard', 'study', 'decks', 'cards', 'templates', 'settings', 'marketplace', 'sharing', 'import-export', 'history', 'guide', 'api-docs', 'landing'],
  defaultNS: 'common',
  resources: { [DEFAULT_LOCALE]: {} },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})
