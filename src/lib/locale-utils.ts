export const SUPPORTED_LOCALES = ['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const SUPPORTED_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文（简体）' },
  { code: 'ja', label: '日本語' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ภาษาไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
] as const satisfies readonly { code: SupportedLocale; label: string }[]

const INTL_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ja: 'ja-JP',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
}

/**
 * Resolve any language string to a supported base locale.
 * e.g. 'ko-KR' → 'ko', 'zh-Hans-CN' → 'zh', undefined → 'en'
 */
export function resolveLocale(lang: string | undefined): SupportedLocale {
  if (!lang) return 'en'
  const base = lang.split('-')[0].toLowerCase()
  if (isSupportedLocale(base)) return base
  return 'en'
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
