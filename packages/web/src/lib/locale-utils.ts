export const SUPPORTED_LOCALES = ['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'en'

export const LOCALE_CONFIG = {
  en: { intl: 'en-US', og: 'en_US', label: 'English', language: 'English', color: 'green' as const },
  ko: { intl: 'ko-KR', og: 'ko_KR', label: '한국어', language: 'Korean', color: 'blue' as const },
  zh: { intl: 'zh-CN', og: 'zh_CN', label: '中文（简体）', language: 'Chinese', color: 'orange' as const },
  ja: { intl: 'ja-JP', og: 'ja_JP', label: '日本語', language: 'Japanese', color: 'purple' as const },
  vi: { intl: 'vi-VN', og: 'vi_VN', label: 'Tiếng Việt', language: 'Vietnamese', color: 'teal' as const },
  th: { intl: 'th-TH', og: 'th_TH', label: 'ภาษาไทย', language: 'Thai', color: 'pink' as const },
  id: { intl: 'id-ID', og: 'id_ID', label: 'Bahasa Indonesia', language: 'Indonesian', color: 'yellow' as const },
  es: { intl: 'es-ES', og: 'es_ES', label: 'Español', language: 'Spanish', color: 'red' as const },
} as const

export const SUPPORTED_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文（简体）' },
  { code: 'ja', label: '日本語' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ภาษาไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'es', label: 'Español' },
] as const satisfies readonly { code: SupportedLocale; label: string }[]

const INTL_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ja: 'ja-JP',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  es: 'es-ES',
}

export const OG_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en_US',
  ko: 'ko_KR',
  zh: 'zh_CN',
  ja: 'ja_JP',
  vi: 'vi_VN',
  th: 'th_TH',
  id: 'id_ID',
  es: 'es_ES',
}

export const LOCALE_LABELS: Record<SupportedLocale, string> = Object.fromEntries(
  SUPPORTED_LANGUAGE_OPTIONS.map((o) => [o.code, o.label]),
) as Record<SupportedLocale, string>

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

/**
 * Type guard: check if a string is a supported base locale.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
}

/** Map a locale code to an Open Graph locale string (e.g. 'ko' → 'ko_KR'). */
export function toOgLocale(lang: string): string {
  return OG_LOCALE_MAP[lang as SupportedLocale] ?? `${lang}_${lang.toUpperCase()}`
}
