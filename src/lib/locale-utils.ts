// ── Master locale configuration — single source of truth ──
export const LOCALE_CONFIG = {
  en: { intl: 'en-US', og: 'en_US', label: 'English', language: 'English', color: 'green' as const },
  ko: { intl: 'ko-KR', og: 'ko_KR', label: '한국어', language: 'Korean', color: 'blue' as const },
  zh: { intl: 'zh-CN', og: 'zh_CN', label: '中文（简体）', language: 'Chinese', color: 'orange' as const },
  ja: { intl: 'ja-JP', og: 'ja_JP', label: '日本語', language: 'Japanese', color: 'purple' as const },
  es: { intl: 'es-ES', og: 'es_ES', label: 'Español', language: 'Spanish', color: 'pink' as const },
} as const

export type SupportedLocale = keyof typeof LOCALE_CONFIG
export const SUPPORTED_LOCALES = Object.keys(LOCALE_CONFIG) as SupportedLocale[]
export const DEFAULT_LOCALE: SupportedLocale = 'en'

// ── Derived maps ──
export const INTL_LOCALE_MAP: Record<SupportedLocale, string> = Object.fromEntries(
  SUPPORTED_LOCALES.map((k) => [k, LOCALE_CONFIG[k].intl]),
) as Record<SupportedLocale, string>

export const OG_LOCALE_MAP: Record<SupportedLocale, string> = Object.fromEntries(
  SUPPORTED_LOCALES.map((k) => [k, LOCALE_CONFIG[k].og]),
) as Record<SupportedLocale, string>

export const LOCALE_LABELS: Record<SupportedLocale, string> = Object.fromEntries(
  SUPPORTED_LOCALES.map((k) => [k, LOCALE_CONFIG[k].label]),
) as Record<SupportedLocale, string>

export const LOCALE_TO_LANGUAGE: Record<SupportedLocale, string> = Object.fromEntries(
  SUPPORTED_LOCALES.map((k) => [k, LOCALE_CONFIG[k].language]),
) as Record<SupportedLocale, string>

// ── Helper functions ──

/**
 * Resolve any language string to a supported base locale.
 * e.g. 'ko-KR' → 'ko', 'zh-Hans-CN' → 'zh', undefined → 'en'
 */
export function resolveLocale(lang: string | undefined): SupportedLocale {
  if (!lang) return DEFAULT_LOCALE
  const base = lang.split('-')[0].toLowerCase()
  if (isSupportedLocale(base)) return base
  return DEFAULT_LOCALE
}

/**
 * Convert a language string to an Intl-compatible locale.
 * e.g. 'ko' → 'ko-KR', 'zh' → 'zh-CN', undefined → 'en-US'
 */
export function toIntlLocale(lang: string | undefined): string {
  return INTL_LOCALE_MAP[resolveLocale(lang)]
}

/**
 * Convert a language string to a content/DB locale.
 * Same as resolveLocale — alias for semantic clarity in content contexts.
 */
export function toContentLocale(lang: string | undefined): SupportedLocale {
  return resolveLocale(lang)
}

/** Map a locale code to an Open Graph locale string (e.g. 'ko' → 'ko_KR'). */
export function toOgLocale(lang: string): string {
  return OG_LOCALE_MAP[lang as SupportedLocale] ?? `${lang}_${lang.toUpperCase()}`
}

/**
 * Type guard: check if a string is a supported base locale.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
}
