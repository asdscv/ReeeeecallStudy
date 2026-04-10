import {
  SITE_URL,
  BRAND_NAME,
  TWITTER_HANDLE,
  DEFAULT_OG_IMAGE,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  OG_LOCALE_MAP,
} from './constants.js'
import {
  escapeHtml,
  buildHreflangTags,
  buildOgLocaleAlternates,
  buildCommonHead,
} from './helpers.js'

export function buildHtmlDocument({ lang, head, body }) {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
${buildCommonHead(lang)}
${head}
</head>
<body>
${body}
</body>
</html>`
}

export function buildMetaTags({
  title,
  description,
  ogType = 'website',
  ogUrl,
  ogImage,
  locale,
  canonical,
  keywords,
  articleMeta,
}) {
  const img = ogImage || DEFAULT_OG_IMAGE
  const lang = locale || 'en'
  const parts = []

  parts.push(`<title>${escapeHtml(title)}</title>`)
  parts.push(`<meta name="description" content="${escapeHtml(description)}">`)

  if (keywords) {
    parts.push(`<meta name="keywords" content="${escapeHtml(keywords)}">`)
  }

  // Open Graph
  parts.push(`<meta property="og:title" content="${escapeHtml(title)}">`)
  parts.push(`<meta property="og:description" content="${escapeHtml(description)}">`)
  parts.push(`<meta property="og:type" content="${ogType}">`)
  if (ogUrl) {
    parts.push(`<meta property="og:url" content="${escapeHtml(ogUrl)}">`)
  }
  parts.push(`<meta property="og:image" content="${escapeHtml(img)}">`)
  parts.push(`<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">`)
  parts.push(`<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">`)
  parts.push(`<meta property="og:image:alt" content="${escapeHtml(title)}">`)
  parts.push(`<meta property="og:site_name" content="${BRAND_NAME}">`)
  parts.push(`<meta property="og:locale" content="${OG_LOCALE_MAP[lang] || 'en_US'}">`)
  parts.push(buildOgLocaleAlternates(lang))

  // Article-specific meta
  if (articleMeta) {
    if (articleMeta.publishedTime) {
      parts.push(`<meta property="article:published_time" content="${escapeHtml(articleMeta.publishedTime)}">`)
    }
    if (articleMeta.modifiedTime) {
      parts.push(`<meta property="article:modified_time" content="${escapeHtml(articleMeta.modifiedTime)}">`)
    }
    if (articleMeta.section) {
      parts.push(`<meta property="article:section" content="${escapeHtml(articleMeta.section)}">`)
    }
    if (articleMeta.author) {
      parts.push(`<meta property="article:author" content="${escapeHtml(articleMeta.author)}">`)
    }
    if (articleMeta.tags) {
      for (const tag of articleMeta.tags) {
        parts.push(`<meta property="article:tag" content="${escapeHtml(tag)}">`)
      }
    }
  }

  // Twitter
  parts.push(`<meta name="twitter:card" content="summary_large_image">`)
  parts.push(`<meta name="twitter:site" content="${TWITTER_HANDLE}">`)
  parts.push(`<meta name="twitter:creator" content="${TWITTER_HANDLE}">`)
  parts.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`)
  parts.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`)
  parts.push(`<meta name="twitter:image" content="${escapeHtml(img)}">`)
  parts.push(`<meta name="twitter:image:alt" content="${escapeHtml(title)}">`)

  // Canonical
  if (canonical) {
    parts.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`)
  }

  // NOTE: hreflang tags are added by each handler directly, not here
  // to avoid duplicate hreflang output

  return parts.join('\n')
}

export function buildSeoResponse(html, { lang = 'en', cacheSeconds = 3600, robots = 'index, follow, max-image-preview:large' } = {}) {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Language': lang,
    'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 24}`,
    'X-Robots-Tag': robots,
  }

  if (lang) {
    headers['Link'] = `<${SITE_URL}>; rel="home"`
  }

  return new Response(html, { headers })
}
