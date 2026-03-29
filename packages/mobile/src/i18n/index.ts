import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// ── Namespace list (single source of truth) ──
const NAMESPACES = [
  'common', 'auth', 'dashboard', 'decks', 'study',
  'marketplace', 'settings', 'history', 'import-export',
  'guide', 'errors', 'paywall',
] as const

// ── Load all locale files per language ──
function loadLang(lang: string) {
  return {
    common: require(`./locales/${lang}/common.json`),
    auth: require(`./locales/${lang}/auth.json`),
    dashboard: require(`./locales/${lang}/dashboard.json`),
    decks: require(`./locales/${lang}/decks.json`),
    study: require(`./locales/${lang}/study.json`),
    marketplace: require(`./locales/${lang}/marketplace.json`),
    settings: require(`./locales/${lang}/settings.json`),
    history: require(`./locales/${lang}/history.json`),
    'import-export': require(`./locales/${lang}/import-export.json`),
    guide: require(`./locales/${lang}/guide.json`),
    errors: require(`./locales/${lang}/errors.json`),
    paywall: require(`./locales/${lang}/paywall.json`),
  }
}

// ── Supported languages (add new languages here) ──
const SUPPORTED_LANGS = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const

const resources: Record<string, ReturnType<typeof loadLang>> = {}
for (const lang of SUPPORTED_LANGS) {
  resources[lang] = loadLang(lang)
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGS],

    ns: [...NAMESPACES],
    defaultNS: 'common',

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
    },
  })

export default i18n
