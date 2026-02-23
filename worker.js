// Cloudflare Worker — API 프록시 + SPA fallback + SEO 프리렌더링 + AI 콘텐츠 생성
import { runContentPipeline } from './worker-modules/content-pipeline.js'
import { LOCALES, DEFAULT_LOCALE, OG_LOCALE_MAP, LIST_TITLES, LIST_DESCS, LANDING_TITLES, LANDING_DESCS } from './worker-modules/config.js'
const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'
const SITE_URL = 'https://reeeeecallstudy.xyz'
const BRAND_NAME = 'ReeeeecallStudy'
const TWITTER_HANDLE = '@reeeeecallstudy'

function buildHreflangTags(basePath, queryParam) {
  return LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}${basePath}${queryParam ? `?lang=${l}` : ''}">`
  ).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL}${basePath}">`
}

function buildOgLocaleAlternates(lang) {
  return LOCALES
    .filter((l) => l !== lang)
    .map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE_MAP[l]}">`)
    .join('\n')
}

const BOT_UA = /googlebot|bingbot|yandex|baiduspider|twitterbot|facebookexternalhit|linkedinbot|slurp|duckduckbot|naverbot|yeti/i

function getSupabaseRestUrl(env) {
  return env.SUPABASE_URL
    ? `${env.SUPABASE_URL}/rest/v1`
    : 'https://ixdapelfikaneexnskfm.supabase.co/rest/v1'
}

function getSupabaseAnonKey(env) {
  return env.SUPABASE_ANON_KEY || ''
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function extractTextFromBlocks(blocks) {
  const texts = []
  for (const block of blocks) {
    if (!block.props) continue
    if (block.props.text) texts.push(block.props.text)
    if (block.props.title) texts.push(block.props.title)
    if (block.props.subtitle) texts.push(block.props.subtitle)
    if (block.props.description) texts.push(block.props.description)
    if (block.props.items) {
      for (const item of block.props.items) {
        if (item.label) texts.push(item.label)
        if (item.value) texts.push(item.value)
        if (item.heading) texts.push(item.heading)
        if (item.description) texts.push(item.description)
        if (item.title) texts.push(item.title)
      }
    }
  }
  return texts.join(' ')
}

async function handleContentBotRequest(url, env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  if (!anonKey) {
    return new Response('Bot prerendering not configured', { status: 500 })
  }

  const slugMatch = url.pathname.match(/^\/insight\/(.+)$/)

  if (slugMatch) {
    // Detail page
    const slug = slugMatch[1]
    const lang = url.searchParams.get('lang') || DEFAULT_LOCALE

    const res = await fetch(
      `${restUrl}/contents?slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&locale=eq.${lang}&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    )

    const data = await res.json()
    const article = data?.[0]

    if (!article) {
      return new Response('Not Found', { status: 404 })
    }

    const blocks = article.content_blocks || []
    const textContent = extractTextFromBlocks(blocks)
    const ogImage = article.og_image_url || article.thumbnail_url || `${SITE_URL}/favicon.png`
    const articleSection = (article.tags || [])[0] || 'Education'

    const articleJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.meta_title || article.title,
      description: article.meta_description || article.subtitle || '',
      image: ogImage,
      datePublished: article.published_at,
      dateModified: article.updated_at,
      author: { '@type': 'Organization', name: article.author_name || BRAND_NAME, url: SITE_URL },
      publisher: {
        '@type': 'Organization',
        name: BRAND_NAME,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` },
      },
      inLanguage: article.locale,
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight/${slug}` },
    }

    const breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: BRAND_NAME, item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Learning Insights', item: `${SITE_URL}/insight` },
        { '@type': 'ListItem', position: 3, name: article.title, item: `${SITE_URL}/insight/${slug}` },
      ],
    }

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(article.locale)}">
<head>
<meta charset="UTF-8">
<meta name="robots" content="index, follow, max-image-preview:large">
<title>${escapeHtml(article.meta_title || article.title)}</title>
<meta name="description" content="${escapeHtml(article.meta_description || article.subtitle || '')}">
<meta name="author" content="${escapeHtml(article.author_name || BRAND_NAME)}">
<meta property="og:title" content="${escapeHtml(article.meta_title || article.title)}">
<meta property="og:description" content="${escapeHtml(article.meta_description || article.subtitle || '')}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE_URL}/insight/${escapeHtml(slug)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[article.locale] || OG_LOCALE_MAP[DEFAULT_LOCALE]}">
${buildOgLocaleAlternates(article.locale)}
${article.published_at ? `<meta property="article:published_time" content="${escapeHtml(article.published_at)}">` : ''}
${article.updated_at ? `<meta property="article:modified_time" content="${escapeHtml(article.updated_at)}">` : ''}
<meta property="article:section" content="${escapeHtml(articleSection)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(article.meta_title || article.title)}">
<meta name="twitter:description" content="${escapeHtml(article.meta_description || article.subtitle || '')}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="canonical" href="${SITE_URL}/insight/${escapeHtml(slug)}">
${buildHreflangTags(`/insight/${escapeHtml(slug)}`, true)}
<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>
</head>
<body>
<article>
<header>
<h1>${escapeHtml(article.title)}</h1>
${article.subtitle ? `<p>${escapeHtml(article.subtitle)}</p>` : ''}
${article.published_at ? `<time datetime="${escapeHtml(article.published_at)}">${new Date(article.published_at).toISOString().split('T')[0]}</time>` : ''}
</header>
<section>${escapeHtml(textContent)}</section>
</article>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Language': article.locale,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  // List page
  const listLang = url.searchParams.get('lang') || DEFAULT_LOCALE

  const res = await fetch(
    `${restUrl}/contents?is_published=eq.true&locale=eq.${listLang}&select=slug,title,subtitle,locale,published_at&order=published_at.desc&limit=50`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  )

  const data = await res.json()
  const articles = data || []

  const listTitle = LIST_TITLES[listLang] || LIST_TITLES.en
  const listDesc = LIST_DESCS[listLang] || LIST_DESCS.en

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: listTitle,
    description: listDesc,
    url: `${SITE_URL}/insight`,
    inLanguage: listLang,
  }

  const articlesHtml = articles
    .map((a) => `<li><a href="${SITE_URL}/insight/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></li>`)
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="${listLang}">
<head>
<meta charset="UTF-8">
<meta name="robots" content="index, follow">
<title>${listTitle}</title>
<meta name="description" content="${escapeHtml(listDesc)}">
<meta property="og:title" content="${listTitle}">
<meta property="og:description" content="${escapeHtml(listDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/insight">
<meta property="og:image" content="${SITE_URL}/favicon.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[listLang] || OG_LOCALE_MAP[DEFAULT_LOCALE]}">
${buildOgLocaleAlternates(listLang)}
<meta name="twitter:card" content="summary">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${listTitle}">
<meta name="twitter:description" content="${escapeHtml(listDesc)}">
<meta name="twitter:image" content="${SITE_URL}/favicon.png">
<link rel="canonical" href="${SITE_URL}/insight">
${buildHreflangTags('/insight', true)}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main>
<h1>${LIST_TITLES[listLang]?.split(' | ')[0] || 'Learning Insights'}</h1>
<ul>${articlesHtml}</ul>
</main>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': listLang,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

async function handleLandingBotRequest(url, env) {
  const lang = url.searchParams.get('lang') || DEFAULT_LOCALE
  const pageTitle = LANDING_TITLES[lang] || LANDING_TITLES.en
  const pageDesc = LANDING_DESCS[lang] || LANDING_DESCS.en

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: BRAND_NAME,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: pageDesc,
    url: SITE_URL,
    inLanguage: lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` },
    },
  }

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="robots" content="index, follow">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(pageDesc)}">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(pageDesc)}">
<meta property="og:image" content="${SITE_URL}/favicon.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[lang] || OG_LOCALE_MAP[DEFAULT_LOCALE]}">
${buildOgLocaleAlternates(lang)}
<meta name="twitter:card" content="summary">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(pageDesc)}">
<meta name="twitter:image" content="${SITE_URL}/favicon.png">
<link rel="canonical" href="${SITE_URL}/landing">
${buildHreflangTags('/landing', true)}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main>
<h1>${escapeHtml(pageTitle)}</h1>
<p>${escapeHtml(pageDesc)}</p>
</main>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

async function handleSitemap(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let contentEntries = ''

  if (anonKey) {
    const res = await fetch(
      `${restUrl}/contents?is_published=eq.true&select=slug,locale,updated_at&order=published_at.desc`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    )

    const data = await res.json()
    const articles = data || []

    // Group by slug for hreflang
    const slugMap = {}
    for (const a of articles) {
      if (!slugMap[a.slug]) slugMap[a.slug] = {}
      slugMap[a.slug][a.locale] = a.updated_at
    }

    for (const [slug, locales] of Object.entries(slugMap)) {
      const lastmod = Object.values(locales).sort().pop()
      contentEntries += `  <url>
    <loc>${SITE_URL}/insight/${slug}</loc>
    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
${LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight/${slug}?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight/${slug}"/>
  </url>\n`
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/landing</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
${LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/landing?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/landing"/>
  </url>
  <url>
    <loc>${SITE_URL}/insight</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
${LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight"/>
  </url>
  <url>
    <loc>${SITE_URL}/docs/api</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
${contentEntries}</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runContentPipeline(env, event.cron))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    const ua = request.headers.get('user-agent') || ''

    // Sitemap (always available, not bot-only)
    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(env)
    }

    // Bot prerendering for content and landing pages
    if (BOT_UA.test(ua)) {
      if (url.pathname === '/insight' || url.pathname.startsWith('/insight/')) {
        return handleContentBotRequest(url, env)
      }
      if (url.pathname === '/' || url.pathname === '/landing') {
        return handleLandingBotRequest(url, env)
      }
    }

    // /api/* → Supabase Edge Function 프록시 (v1 엔드포인트 + doc/ui)
    if (url.pathname.startsWith('/api/')) {
      // OPTIONS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        })
      }

      const subpath = url.pathname.slice('/api/'.length)
      const target = `${SUPABASE_BASE}/${subpath}${url.search}`

      const headers = new Headers(request.headers)
      headers.delete('host')

      const res = await fetch(target, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? request.body
          : undefined,
      })

      const responseHeaders = new Headers(res.headers)
      responseHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      })
    }

    // 정적 에셋은 assets 바인딩이 자동 처리 (wrangler.jsonc의 assets 설정)
    return new Response('Not Found', { status: 404 })
  },
}
