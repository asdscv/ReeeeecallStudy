// Cloudflare Worker — API 프록시 + SPA fallback + SEO 프리렌더링
const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'
const SITE_URL = 'https://reeeeecallstudy.com'

const BOT_UA = /googlebot|bingbot|yandex|baiduspider|twitterbot|facebookexternalhit|linkedinbot|slurp|duckduckbot/i

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

  const slugMatch = url.pathname.match(/^\/content\/(.+)$/)

  if (slugMatch) {
    // Detail page
    const slug = slugMatch[1]
    const lang = url.searchParams.get('lang') || 'en'

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
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.meta_title || article.title,
      description: article.meta_description || article.subtitle || '',
      image: article.og_image_url || article.thumbnail_url || `${SITE_URL}/favicon.png`,
      datePublished: article.published_at,
      dateModified: article.updated_at,
      author: { '@type': 'Organization', name: article.author_name || 'ReeeCall' },
      publisher: {
        '@type': 'Organization',
        name: 'ReeeeecallStudy',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` },
      },
      inLanguage: article.locale,
    }

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(article.locale)}">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(article.meta_title || article.title)}</title>
<meta name="description" content="${escapeHtml(article.meta_description || article.subtitle || '')}">
<meta property="og:title" content="${escapeHtml(article.meta_title || article.title)}">
<meta property="og:description" content="${escapeHtml(article.meta_description || article.subtitle || '')}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE_URL}/content/${escapeHtml(slug)}">
${article.og_image_url ? `<meta property="og:image" content="${escapeHtml(article.og_image_url)}">` : ''}
<link rel="canonical" href="${SITE_URL}/content/${escapeHtml(slug)}">
<link rel="alternate" hreflang="en" href="${SITE_URL}/content/${escapeHtml(slug)}?lang=en">
<link rel="alternate" hreflang="ko" href="${SITE_URL}/content/${escapeHtml(slug)}?lang=ko">
<link rel="alternate" hreflang="x-default" href="${SITE_URL}/content/${escapeHtml(slug)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<article>
<h1>${escapeHtml(article.title)}</h1>
${article.subtitle ? `<p>${escapeHtml(article.subtitle)}</p>` : ''}
<div>${escapeHtml(textContent)}</div>
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
  const res = await fetch(
    `${restUrl}/contents?is_published=eq.true&select=slug,title,subtitle,locale,published_at&order=published_at.desc&limit=50`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  )

  const data = await res.json()
  const articles = data || []

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Learning Insights | ReeeCall',
    description: 'Discover science-backed learning strategies and spaced repetition tips.',
    url: `${SITE_URL}/content`,
  }

  const articlesHtml = articles
    .map((a) => `<li><a href="${SITE_URL}/content/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></li>`)
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Learning Insights | ReeeCall</title>
<meta name="description" content="Discover science-backed learning strategies and spaced repetition tips.">
<meta property="og:title" content="Learning Insights | ReeeCall">
<meta property="og:description" content="Discover science-backed learning strategies and spaced repetition tips.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/content">
<link rel="canonical" href="${SITE_URL}/content">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<h1>Learning Insights</h1>
<ul>${articlesHtml}</ul>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

async function handleLandingBotRequest(env) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'ReeeeecallStudy',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: 'Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm',
    url: SITE_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: {
      '@type': 'Organization',
      name: 'ReeeeecallStudy',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` },
    },
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ReeeeecallStudy — Smart Flashcard Learning with Spaced Repetition</title>
<meta name="description" content="Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm. Remember faster and longer.">
<meta property="og:title" content="ReeeeecallStudy">
<meta property="og:description" content="Smart flashcard learning platform with SRS">
<meta property="og:image" content="${SITE_URL}/favicon.png">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE_URL}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<h1>ReeeeecallStudy — Smart Flashcard Learning with Spaced Repetition</h1>
<p>Maximize your learning efficiency with scientifically proven spaced repetition (SRS). Remember faster and longer.</p>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
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
    <loc>${SITE_URL}/content/${slug}</loc>
    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/content/${slug}?lang=en"/>
    <xhtml:link rel="alternate" hreflang="ko" href="${SITE_URL}/content/${slug}?lang=ko"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/content/${slug}"/>
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
    <loc>${SITE_URL}/content</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
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
  async fetch(request, env) {
    const url = new URL(request.url)
    const ua = request.headers.get('user-agent') || ''

    // Sitemap (always available, not bot-only)
    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(env)
    }

    // Bot prerendering for content and landing pages
    if (BOT_UA.test(ua)) {
      if (url.pathname === '/content' || url.pathname.startsWith('/content/')) {
        return handleContentBotRequest(url, env)
      }
      if (url.pathname === '/') {
        return handleLandingBotRequest(env)
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
