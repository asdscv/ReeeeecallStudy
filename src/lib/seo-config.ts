import { SUPPORTED_LOCALES, DEFAULT_LOCALE, toOgLocale } from './locale-utils'

// Re-export toOgLocale for existing consumers
export { toOgLocale }

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
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} as const
