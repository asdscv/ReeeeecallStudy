import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'auth', 'errors', 'dashboard', 'study', 'decks', 'cards', 'templates', 'settings', 'marketplace', 'sharing', 'import-export', 'history', 'guide', 'api-docs', 'landing'],
  defaultNS: 'common',
  resources: { en: {} },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})
