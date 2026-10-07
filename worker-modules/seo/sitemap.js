// Dynamic sitemap handler — sitemap index + sub-sitemaps
import { SITE_URL, INDEXABLE_LOCALES } from './constants.js'
import { escapeHtml, getSupabaseRestUrl, getSupabaseAnonKey, localizedUrl } from './helpers.js'
import { isIndexable } from '../locale-policy.js'

const URLSET_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`

function xmlResponse(xml) {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}

// Sitemap index — /sitemap.xml
export async function handleSitemap() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemap-static.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemap-articles.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemap-listings.xml</loc>
  </sitemap>
</sitemapindex>`
  return xmlResponse(xml)
}

// Static pages — /sitemap-static.xml
export async function handleSitemapStatic() {
  const entries = ['/landing', '/insight'].flatMap((path) => INDEXABLE_LOCALES.map((locale) => `  <url>
    <loc>${escapeHtml(localizedUrl(path, locale))}</loc>
${INDEXABLE_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(localizedUrl(path, l))}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${path}"/>
  </url>`)).join('\n')
  const xml = `${URLSET_HEADER}\n${entries}\n</urlset>`
  return xmlResponse(xml)
}

// Article pages — /sitemap-articles.xml
export async function handleSitemapArticles(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let contentEntries = ''

  if (!anonKey) return sitemapUnavailable()
  if (anonKey) {
    try {
      // PostgREST caps each response at max_rows. Read bounded pages in a stable
      // order, including every published indexable locale instead of just the newest slice.
      const PAGE = 500
      const articles = []
      for (let offset = 0; ; offset += PAGE) {
        const contentRes = await fetch(
          `${restUrl}/contents?is_published=eq.true&locale=in.(${INDEXABLE_LOCALES.join(',')})`
            + `&select=slug,locale,updated_at,title,thumbnail_url,og_image_url&order=published_at.desc,id.asc&offset=${offset}&limit=${PAGE}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
        )
        if (!contentRes.ok) throw new Error(`Sitemap articles fetch failed: ${contentRes.status}`)
        const page = await contentRes.json()
        if (!Array.isArray(page)) throw new Error('Invalid sitemap article response')
        articles.push(...page)
        if (page.length < PAGE) break
        // Never replace a complete sitemap with a silently truncated one.
        if (articles.length >= 50_000) throw new Error('Article sitemap needs partitioning')
      }

      const slugMap = Object.create(null)
      for (const a of articles) {
        if (!slugMap[a.slug]) slugMap[a.slug] = { locales: {} }
        slugMap[a.slug].locales[a.locale] = a
      }

      for (const [slug, info] of Object.entries(slugMap)) {
        const existingLocales = Object.keys(info.locales)
        // Only sitemap articles with ≥1 indexable locale, and advertise hreflang
        // for indexable locales only (minor languages are noindex now).
        const indexableLocales = existingLocales.filter(isIndexable)
        if (indexableLocales.length === 0) continue
        const path = `/insight/${encodeURIComponent(slug)}`
        const defaultUrl = localizedUrl(path, indexableLocales.includes('en') ? 'en' : indexableLocales[0])
        for (const locale of indexableLocales) {
          const article = info.locales[locale]
          const image = article.og_image_url || article.thumbnail_url
          const imageTag = image
            ? `\n    <image:image>\n      <image:loc>${escapeHtml(image)}</image:loc>\n      <image:title>${escapeHtml(article.title)}</image:title>\n    </image:image>`
            : ''
          contentEntries += `  <url>
    <loc>${escapeHtml(localizedUrl(path, locale))}</loc>
    <lastmod>${new Date(article.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>${imageTag}
${indexableLocales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(localizedUrl(path, l))}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(defaultUrl)}"/>
  </url>\n`
        }
      }
    } catch (err) {
      console.error('Sitemap articles error:', err)
      return sitemapUnavailable()
    }
  }

  return xmlResponse(`${URLSET_HEADER}\n${contentEntries}</urlset>`)
}

function sitemapUnavailable() {
  return new Response('Sitemap temporarily unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
  })
}

// Marketplace listings — /sitemap-listings.xml
export async function handleSitemapListings(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let listingEntries = ''

  if (anonKey) {
    try {
      // Page rather than take one slice. A flat `limit=500` silently dropped 150 of the
      // 650 active decks — they were never submitted to any search engine — and simply
      // raising the number does not fix it: PostgREST caps a response at max_rows (1000
      // in production) and ignores anything larger, so the next 350 decks would vanish
      // the same way. `created_at` is not unique across a bulk import, so it alone can
      // repeat or skip rows across page boundaries; `id` breaks the tie.
      const listings = []
      const PAGE = 500
      for (let offset = 0; ; offset += PAGE) {
        const listingRes = await fetch(
          `${restUrl}/marketplace_listings?is_active=eq.true&select=id,updated_at`
            + `&order=created_at.desc,id.asc&offset=${offset}&limit=${PAGE}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
        )
        const page = (await listingRes.json()) || []
        if (!Array.isArray(page) || page.length === 0) break
        listings.push(...page)
        if (page.length < PAGE) break
        // Backstop: a sitemap file may hold 50,000 URLs, and a paging bug must not spin.
        if (listings.length >= 50_000) break
      }

      for (const l of listings) {
        const lastmod = l.updated_at ? new Date(l.updated_at).toISOString().split('T')[0] : ''
        listingEntries += `  <url>
    <loc>${SITE_URL}/d/${l.id}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/d/${l.id}"/>
  </url>\n`
      }
    } catch {
      // listings table may not exist yet — skip
    }
  }

  return xmlResponse(`${URLSET_HEADER}\n${listingEntries}</urlset>`)
}
