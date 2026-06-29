// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for per-locale capabilities (SoC + DIP).
//
// Every locale-aware concern in the worker — content GENERATION, SEO INDEXING
// signals (sitemap / hreflang / robots), and UI SERVING — reads from this one
// registry instead of hard-coding language arrays. Flip ONE flag here to change
// a locale's behaviour; no consumer code changes (Open/Closed Principle).
//
//   generate : the daily content pipeline produces articles in this locale
//   index    : search engines are TOLD to index it (sitemap + hreflang + robots)
//   ui       : the app serves/renders it to humans
//
// Re-expansion playbook (when domain authority grows — see DOCS/TODO/SEO-LOCALE-POLICY.md):
//   • Resume publishing Spanish   → set es.generate = true
//   • Let Google index Japanese   → set ja.index = true
// Nothing else needs editing.
// ─────────────────────────────────────────────────────────────────────────────

export const LOCALE_REGISTRY = {
  en: { generate: true, index: true, ui: true },
  ko: { generate: true, index: true, ui: true },
  // Minor locales: kept SERVING to existing users (ui), but no longer generated
  // or indexed — their thin auto-translated pages were diluting site-wide quality.
  zh: { generate: false, index: false, ui: true },
  ja: { generate: false, index: false, ui: true },
  vi: { generate: false, index: false, ui: true },
  th: { generate: false, index: false, ui: true },
  id: { generate: false, index: false, ui: true },
  es: { generate: false, index: false, ui: true },
}

// The canonical/default locale. Invariant: must be both generated and indexable.
export const DEFAULT_LOCALE = 'en'

function localesWhere(flag) {
  return Object.keys(LOCALE_REGISTRY).filter((l) => LOCALE_REGISTRY[l][flag] === true)
}

// Derived views — registry insertion order preserved → deterministic SEO output.
export const ALL_LOCALES = Object.keys(LOCALE_REGISTRY)
export const GENERATED_LOCALES = localesWhere('generate')
export const INDEXABLE_LOCALES = localesWhere('index')
export const UI_LOCALES = localesWhere('ui')

export function isGenerated(locale) {
  return LOCALE_REGISTRY[locale]?.generate === true
}
export function isIndexable(locale) {
  return LOCALE_REGISTRY[locale]?.index === true
}
export function isUiLocale(locale) {
  return LOCALE_REGISTRY[locale]?.ui === true
}

// Fail-fast invariant: a default locale that isn't generated+indexable would
// silently break canonical/sitemap/generation. Catch the misconfig at load.
if (!isGenerated(DEFAULT_LOCALE) || !isIndexable(DEFAULT_LOCALE)) {
  throw new Error(
    `locale-policy: DEFAULT_LOCALE "${DEFAULT_LOCALE}" must have generate:true and index:true`,
  )
}
