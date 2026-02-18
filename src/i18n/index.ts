import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpBackend from 'i18next-http-backend'

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ko'],

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
      'api-docs',
      'landing',
      'content',
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

export default i18n
