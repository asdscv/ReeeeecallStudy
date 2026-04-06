import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Platform, NativeModules } from 'react-native'

// ── Supported languages: to add a new language, add an entry below + locale folder ──

const resources = {
  en: {
    common: require('./locales/en/common.json'),
    auth: require('./locales/en/auth.json'),
    dashboard: require('./locales/en/dashboard.json'),
    decks: require('./locales/en/decks.json'),
    study: require('./locales/en/study.json'),
    marketplace: require('./locales/en/marketplace.json'),
    settings: require('./locales/en/settings.json'),
    history: require('./locales/en/history.json'),
    'import-export': require('./locales/en/import-export.json'),
    guide: require('./locales/en/guide.json'),
    errors: require('./locales/en/errors.json'),
    paywall: require('./locales/en/paywall.json'),
  },
  ko: {
    common: require('./locales/ko/common.json'),
    auth: require('./locales/ko/auth.json'),
    dashboard: require('./locales/ko/dashboard.json'),
    decks: require('./locales/ko/decks.json'),
    study: require('./locales/ko/study.json'),
    marketplace: require('./locales/ko/marketplace.json'),
    settings: require('./locales/ko/settings.json'),
    history: require('./locales/ko/history.json'),
    'import-export': require('./locales/ko/import-export.json'),
    guide: require('./locales/ko/guide.json'),
    errors: require('./locales/ko/errors.json'),
    paywall: require('./locales/ko/paywall.json'),
  },
  ja: {
    common: require('./locales/ja/common.json'),
    auth: require('./locales/ja/auth.json'),
    dashboard: require('./locales/ja/dashboard.json'),
    decks: require('./locales/ja/decks.json'),
    study: require('./locales/ja/study.json'),
    marketplace: require('./locales/ja/marketplace.json'),
    settings: require('./locales/ja/settings.json'),
    history: require('./locales/ja/history.json'),
    'import-export': require('./locales/ja/import-export.json'),
    guide: require('./locales/ja/guide.json'),
    errors: require('./locales/ja/errors.json'),
    paywall: require('./locales/ja/paywall.json'),
  },
  zh: {
    common: require('./locales/zh/common.json'),
    auth: require('./locales/zh/auth.json'),
    dashboard: require('./locales/zh/dashboard.json'),
    decks: require('./locales/zh/decks.json'),
    study: require('./locales/zh/study.json'),
    marketplace: require('./locales/zh/marketplace.json'),
    settings: require('./locales/zh/settings.json'),
    history: require('./locales/zh/history.json'),
    'import-export': require('./locales/zh/import-export.json'),
    guide: require('./locales/zh/guide.json'),
    errors: require('./locales/zh/errors.json'),
    paywall: require('./locales/zh/paywall.json'),
  },
  vi: {
    common: require('./locales/vi/common.json'),
    auth: require('./locales/vi/auth.json'),
    dashboard: require('./locales/vi/dashboard.json'),
    decks: require('./locales/vi/decks.json'),
    study: require('./locales/vi/study.json'),
    marketplace: require('./locales/vi/marketplace.json'),
    settings: require('./locales/vi/settings.json'),
    history: require('./locales/vi/history.json'),
    'import-export': require('./locales/vi/import-export.json'),
    guide: require('./locales/vi/guide.json'),
    errors: require('./locales/vi/errors.json'),
    paywall: require('./locales/vi/paywall.json'),
  },
  th: {
    common: require('./locales/th/common.json'),
    auth: require('./locales/th/auth.json'),
    dashboard: require('./locales/th/dashboard.json'),
    decks: require('./locales/th/decks.json'),
    study: require('./locales/th/study.json'),
    marketplace: require('./locales/th/marketplace.json'),
    settings: require('./locales/th/settings.json'),
    history: require('./locales/th/history.json'),
    'import-export': require('./locales/th/import-export.json'),
    guide: require('./locales/th/guide.json'),
    errors: require('./locales/th/errors.json'),
    paywall: require('./locales/th/paywall.json'),
  },
  id: {
    common: require('./locales/id/common.json'),
    auth: require('./locales/id/auth.json'),
    dashboard: require('./locales/id/dashboard.json'),
    decks: require('./locales/id/decks.json'),
    study: require('./locales/id/study.json'),
    marketplace: require('./locales/id/marketplace.json'),
    settings: require('./locales/id/settings.json'),
    history: require('./locales/id/history.json'),
    'import-export': require('./locales/id/import-export.json'),
    guide: require('./locales/id/guide.json'),
    errors: require('./locales/id/errors.json'),
    paywall: require('./locales/id/paywall.json'),
  },
  es: {
    common: require('./locales/es/common.json'),
    auth: require('./locales/es/auth.json'),
    dashboard: require('./locales/es/dashboard.json'),
    decks: require('./locales/es/decks.json'),
    study: require('./locales/es/study.json'),
    marketplace: require('./locales/es/marketplace.json'),
    settings: require('./locales/es/settings.json'),
    history: require('./locales/es/history.json'),
    'import-export': require('./locales/es/import-export.json'),
    guide: require('./locales/es/guide.json'),
    errors: require('./locales/es/errors.json'),
    paywall: require('./locales/es/paywall.json'),
  },
}

const supportedLngs = Object.keys(resources)

// Detect device language using RN built-in NativeModules (no extra native dep)
function getDeviceLanguage(): string {
  try {
    let locale = 'en'
    if (Platform.OS === 'ios') {
      locale =
        NativeModules.SettingsManager?.settings?.AppleLocale ??
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ??
        'en'
    } else {
      // Android: try multiple approaches
      locale =
        NativeModules.I18nManager?.localeIdentifier ??
        NativeModules.I18nManager?.locale ??
        'en'
    }
    console.log('[i18n] Raw device locale:', locale, '| Platform:', Platform.OS)
    console.log('[i18n] I18nManager:', JSON.stringify(NativeModules.I18nManager))
    const code = locale.split(/[-_]/)[0]
    if (supportedLngs.includes(code)) return code
  } catch (e) {
    console.log('[i18n] Detection error:', e)
  }
  return 'en'
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getDeviceLanguage(),
    fallbackLng: 'en',
    supportedLngs,

    ns: ['common', 'auth', 'dashboard', 'decks', 'study', 'marketplace', 'settings', 'history', 'import-export', 'guide', 'errors', 'paywall'],
    defaultNS: 'common',

    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

export default i18n
