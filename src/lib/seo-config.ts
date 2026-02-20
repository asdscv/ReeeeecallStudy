// Centralized SEO configuration — single source of truth
export const SEO = {
  SITE_URL: 'https://reeeeecallstudy.xyz',
  BRAND_NAME: 'ReeeeecallStudy',
  TWITTER_HANDLE: '@reeeeecallstudy',
  DEFAULT_OG_IMAGE: 'https://reeeeecallstudy.xyz/og-image.png',
  OG_IMAGE_WIDTH: 1200,
  OG_IMAGE_HEIGHT: 630,
  THEME_COLOR: '#2563eb',
  AUTHOR_NAME: 'ReeeeecallStudy',
  CONTACT_EMAIL: 'admin@reeeeecallstudy.xyz',
  DEFAULT_LOCALE: 'en',
  SUPPORTED_LOCALES: ['en', 'ko', 'zh', 'ja'] as const,
} as const

const OG_LOCALE_MAP: Record<string, string> = {
  en: 'en_US',
  ko: 'ko_KR',
  ja: 'ja_JP',
  zh: 'zh_CN',
}

/** Map a locale code to an Open Graph locale string (e.g. 'ko' → 'ko_KR'). */
export function toOgLocale(lang: string): string {
  return OG_LOCALE_MAP[lang] ?? `${lang}_${lang.toUpperCase()}`
}
