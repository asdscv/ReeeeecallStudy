import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { formatDecimal } from '@reeeeecall/shared/lib/format-number'
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpBackend from 'i18next-http-backend'

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ko', 'zh', 'ja', 'es', 'vi', 'th', 'id'],

    ns: [
      'common',
      'auth',
      'errors',
      'dashboard',
      'study',
      'decks',
      'cards',
      'templates',
      'settings',
      'marketplace',
      'sharing',
      'import-export',
      'history',
      'guide',
      'landing',
      'content',
      'admin',
      'ai-generate',
      'wallet',
      'billing',
      'learning',
    ],
    defaultNS: 'common',

    // Preload essential namespaces
    partialBundledLanguages: true,

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'reeeeecall-lang',
      caches: ['localStorage'],
    },

    interpolation: {
      escapeValue: false, // React already escapes
    },

    react: {
      useSuspense: true,
    },
  })

// Mirror the mobile app's Intl-free formatters so the SHARED locale strings mean the same
// thing on both platforms. `{{x, decimal}}` is used where the value is deliberately
// fractional; mobile cannot route those through Intl (an ICU-less Hermes build drops the
// separators silently), and a spec registered on only one platform would render differently.
i18n.services.formatter?.add('decimal', (value) =>
  typeof value === 'number' ? formatDecimal(value, 1) : String(value ?? ''),
)

export default i18n
