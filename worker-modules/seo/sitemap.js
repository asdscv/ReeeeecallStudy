// Dynamic sitemap handler — sitemap index + sub-sitemaps
import { SITE_URL, SUPPORTED_LOCALES } from './constants.js'
import { escapeHtml, getSupabaseRestUrl, getSupabaseAnonKey } from './helpers.js'

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
  const today = new Date().toISOString().split('T')[0]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemap-static.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemap-articles.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemap-listings.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`
  return xmlResponse(xml)
}

// Static pages — /sitemap-static.xml
export async function handleSitemapStatic() {
  const xml = `${URLSET_HEADER}
  <url>
    <loc>${SITE_URL}/landing</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/landing?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/landing"/>
  </url>
  <url>
    <loc>${SITE_URL}/insight</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight"/>
  </url>
  <url>
    <loc>${SITE_URL}/docs/api</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`
  return xmlResponse(xml)
}

// Article pages — /sitemap-articles.xml
export async function handleSitemapArticles(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let contentEntries = ''

  if (anonKey) {
    const contentRes = await fetch(
      `${restUrl}/contents?is_published=eq.true&select=slug,locale,updated_at,title,thumbnail_url,og_image_url&order=published_at.desc`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
    )
    const contentData = await contentRes.json()
    const articles = contentData || []

    const slugMap = {}
    for (const a of articles) {
      if (!slugMap[a.slug]) slugMap[a.slug] = { locales: {}, title: a.title, image: a.og_image_url || a.thumbnail_url }
      slugMap[a.slug].locales[a.locale] = a.updated_at
      if (!slugMap[a.slug].image && (a.og_image_url || a.thumbnail_url)) {
        slugMap[a.slug].image = a.og_image_url || a.thumbnail_url
      }
    }

    for (const [slug, info] of Object.entries(slugMap)) {
      const lastmod = Object.values(info.locales).sort().pop()
      const imageTag = info.image
        ? `\n    <image:image>\n      <image:loc>${escapeHtml(info.image)}</image:loc>\n      <image:title>${escapeHtml(info.title)}</image:title>\n    </image:image>`
        : ''
      contentEntries += `  <url>
    <loc>${SITE_URL}/insight/${slug}</loc>
    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>${imageTag}
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight/${slug}?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight/${slug}"/>
  </url>\n`
    }
  }

  return xmlResponse(`${URLSET_HEADER}\n${contentEntries}</urlset>`)
}

// Marketplace listings — /sitemap-listings.xml
export async function handleSitemapListings(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let listingEntries = ''

  if (anonKey) {
    try {
      const listingRes = await fetch(
        `${restUrl}/marketplace_listings?is_active=eq.true&select=id,updated_at&order=created_at.desc&limit=500`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
      )
      const listingData = await listingRes.json()
      const listings = listingData || []

      for (const l of listings) {
        const lastmod = l.updated_at ? new Date(l.updated_at).toISOString().split('T')[0] : ''
        listingEntries += `  <url>
    <loc>${SITE_URL}/d/${l.id}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
${SUPPORTED_LOCALES.map((ll) => `    <xhtml:link rel="alternate" hreflang="${ll}" href="${SITE_URL}/d/${l.id}?lang=${ll}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/d/${l.id}"/>
  </url>\n`
      }
    } catch {
      // listings table may not exist yet — skip
    }
  }

  return xmlResponse(`${URLSET_HEADER}\n${listingEntries}</urlset>`)
}
