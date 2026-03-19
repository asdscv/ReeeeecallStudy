import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// English
import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enDashboard from './locales/en/dashboard.json'
import enDecks from './locales/en/decks.json'
import enStudy from './locales/en/study.json'
import enMarketplace from './locales/en/marketplace.json'
import enSettings from './locales/en/settings.json'
import enHistory from './locales/en/history.json'
import enImportExport from './locales/en/import-export.json'
import enGuide from './locales/en/guide.json'
import enErrors from './locales/en/errors.json'
import enPaywall from './locales/en/paywall.json'

// Korean
import koCommon from './locales/ko/common.json'
import koAuth from './locales/ko/auth.json'
import koDashboard from './locales/ko/dashboard.json'
import koDecks from './locales/ko/decks.json'
import koStudy from './locales/ko/study.json'
import koMarketplace from './locales/ko/marketplace.json'
import koSettings from './locales/ko/settings.json'
import koHistory from './locales/ko/history.json'
import koImportExport from './locales/ko/import-export.json'
import koGuide from './locales/ko/guide.json'
import koErrors from './locales/ko/errors.json'
import koPaywall from './locales/ko/paywall.json'

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    decks: enDecks,
    study: enStudy,
    marketplace: enMarketplace,
    settings: enSettings,
    history: enHistory,
    'import-export': enImportExport,
    guide: enGuide,
    errors: enErrors,
    paywall: enPaywall,
  },
  ko: {
    common: koCommon,
    auth: koAuth,
    dashboard: koDashboard,
    decks: koDecks,
    study: koStudy,
    marketplace: koMarketplace,
    settings: koSettings,
    history: koHistory,
    'import-export': koImportExport,
    guide: koGuide,
    errors: koErrors,
    paywall: koPaywall,
  },
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ko'],

    ns: [
      'common',
      'auth',
      'dashboard',
      'decks',
      'study',
      'marketplace',
      'settings',
      'history',
      'import-export',
      'guide',
      'errors',
      'paywall',
    ],
    defaultNS: 'common',

    interpolation: {
      escapeValue: false, // React Native handles escaping
    },

    react: {
      useSuspense: false, // No Suspense in React Native
    },
  })

export default i18n
