import { describe, it, expect } from 'vitest'
import { generateSitemapXml } from '../sitemap'

describe('generateSitemapXml', () => {
  const staticPages = [
    { loc: 'https://reeeeecallstudy.xyz', changefreq: 'weekly' as const, priority: 1.0 },
    { loc: 'https://reeeeecallstudy.xyz/content', changefreq: 'daily' as const, priority: 0.9 },
  ]

  const contentPages = [
    {
      loc: 'https://reeeeecallstudy.xyz/content/spaced-repetition-guide',
      lastmod: '2025-06-01T00:00:00Z',
      changefreq: 'monthly' as const,
      priority: 0.8,
    },
    {
      loc: 'https://reeeeecallstudy.xyz/content/active-recall-techniques',
      lastmod: '2025-07-15T00:00:00Z',
      changefreq: 'monthly' as const,
      priority: 0.8,
    },
  ]

  it('should generate valid XML with xml declaration', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
  })

  it('should include urlset with sitemap namespace', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })

  it('should include xhtml namespace for hreflang', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  })

  it('should include all static pages', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml).toContain('<loc>https://reeeeecallstudy.xyz</loc>')
    expect(xml).toContain('<loc>https://reeeeecallstudy.xyz/content</loc>')
  })

  it('should include all content pages', () => {
    const xml = generateSitemapXml([], contentPages)
    expect(xml).toContain('<loc>https://reeeeecallstudy.xyz/content/spaced-repetition-guide</loc>')
    expect(xml).toContain('<loc>https://reeeeecallstudy.xyz/content/active-recall-techniques</loc>')
  })

  it('should include lastmod for content pages', () => {
    const xml = generateSitemapXml([], contentPages)
    expect(xml).toContain('<lastmod>2025-06-01</lastmod>')
    expect(xml).toContain('<lastmod>2025-07-15</lastmod>')
  })

  it('should include changefreq and priority', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml).toContain('<changefreq>weekly</changefreq>')
    expect(xml).toContain('<priority>1.0</priority>')
  })

  it('should include hreflang alternates for content pages', () => {
    const xml = generateSitemapXml([], contentPages)
    expect(xml).toContain('hreflang="en"')
    expect(xml).toContain('hreflang="ko"')
    expect(xml).toContain('hreflang="x-default"')
  })

  it('should include hreflang alternates for static pages', () => {
    const xml = generateSitemapXml(staticPages, [])
    // Static pages should also have hreflang for multilingual support
    const landingSection = xml.split('<loc>https://reeeeecallstudy.xyz</loc>')[1].split('</url>')[0]
    expect(landingSection).toContain('hreflang="en"')
    expect(landingSection).toContain('hreflang="ko"')
    expect(landingSection).toContain('hreflang="x-default"')
  })

  it('should combine static and content pages', () => {
    const xml = generateSitemapXml(staticPages, contentPages)
    const urlCount = (xml.match(/<url>/g) || []).length
    expect(urlCount).toBe(4)
  })

  it('should return valid closing tag', () => {
    const xml = generateSitemapXml(staticPages, [])
    expect(xml.trim()).toMatch(/<\/urlset>$/)
  })
})
