import {
  SITE_URL,
  BRAND_NAME,
  DEFAULT_OG_IMAGE,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  SUPPORTED_LOCALES,
  OG_LOCALE_MAP,
} from './constants.js'

export function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildHreflangTags(basePath, queryParam) {
  return SUPPORTED_LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}${basePath}${queryParam ? `?lang=${l}` : ''}">`
  ).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL}${basePath}">`
}

export function buildOgLocaleAlternates(lang) {
  return SUPPORTED_LOCALES
    .filter((l) => l !== lang)
    .map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE_MAP[l] || `${l}_${l.toUpperCase()}`}">`)
    .join('\n')
}

export function buildCommonHead(lang) {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="#2563eb">
<link rel="icon" type="image/png" href="/favicon.png">
<meta name="author" content="${BRAND_NAME}">`
}

export function getSupabaseRestUrl(env) {
  return env.SUPABASE_URL
    ? `${env.SUPABASE_URL}/rest/v1`
    : 'https://ixdapelfikaneexnskfm.supabase.co/rest/v1'
}

export function getSupabaseAnonKey(env) {
  return env.SUPABASE_ANON_KEY || ''
}

export function localizedUrl(path, locale) {
  if (locale === 'en') return `${SITE_URL}${path}`
  return `${SITE_URL}${path}?lang=${locale}`
}

export function buildPublisherJsonLd() {
  return {
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
  }
}
