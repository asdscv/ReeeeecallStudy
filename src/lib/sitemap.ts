import { SEO } from './seo-config'

interface SitemapEntry {
  loc: string
  lastmod?: string
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority: number
}

function formatDate(iso: string): string {
  return iso.split('T')[0]
}

function buildUrlEntry(entry: SitemapEntry, includeHreflang = false): string {
  const lines = ['  <url>']
  lines.push(`    <loc>${entry.loc}</loc>`)
  if (entry.lastmod) {
    lines.push(`    <lastmod>${formatDate(entry.lastmod)}</lastmod>`)
  }
  lines.push(`    <changefreq>${entry.changefreq}</changefreq>`)
  lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`)

  if (includeHreflang) {
    const basePath = entry.loc.replace(SEO.SITE_URL, '')
    for (const lang of SEO.SUPPORTED_LOCALES) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${SEO.SITE_URL}${basePath}?lang=${lang}" />`)
    }
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${entry.loc}" />`)
  }

  lines.push('  </url>')
  return lines.join('\n')
}

export function generateSitemapXml(
  staticPages: SitemapEntry[],
  contentPages: SitemapEntry[],
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ]

  for (const page of staticPages) {
    lines.push(buildUrlEntry(page))
  }

  for (const page of contentPages) {
    lines.push(buildUrlEntry(page, true))
  }

  lines.push('</urlset>')
  return lines.join('\n')
}
