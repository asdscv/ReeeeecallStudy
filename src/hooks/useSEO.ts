import { useEffect } from 'react'
import i18next from 'i18next'
import { SEO } from '../lib/seo-config'

interface SEOOptions {
  title: string
  description: string
  ogImage?: string
  ogImageWidth?: number
  ogImageHeight?: number
  ogType?: 'article' | 'website'
  canonicalUrl?: string
  jsonLd?: object | object[]
  hreflangAlternates?: Array<{ lang: string; href: string }>
  publishedTime?: string
  modifiedTime?: string
  articleSection?: string
}

function setMeta(attr: string, key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function removeMeta(attr: string, key: string) {
  const el = document.querySelector(`meta[${attr}="${key}"]`)
  if (el) el.remove()
}

function setLink(rel: string, key: string, href: string) {
  const selector = key ? `link[rel="${rel}"][hreflang="${key}"]` : `link[rel="${rel}"]:not([hreflang])`
  let el = document.querySelector(selector) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    if (key) el.hreflang = key
    document.head.appendChild(el)
  }
  el.href = href
}

function removeLink(rel: string, hreflang?: string) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`
  const el = document.querySelector(selector)
  if (el) el.remove()
}

export function useSEO(options: SEOOptions) {
  const {
    title,
    description,
    ogImage,
    ogImageWidth,
    ogImageHeight,
    ogType = 'website',
    canonicalUrl,
    jsonLd,
    hreflangAlternates,
    publishedTime,
    modifiedTime,
    articleSection,
  } = options

  useEffect(() => {
    // Title
    const prevTitle = document.title
    document.title = title

    // HTML lang
    const prevLang = document.documentElement.lang
    const currentLang = i18next.language || SEO.DEFAULT_LOCALE
    document.documentElement.lang = currentLang

    // Description
    setMeta('name', 'description', description)

    // Open Graph core
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:type', ogType)
    setMeta('property', 'og:site_name', SEO.BRAND_NAME)
    setMeta('property', 'og:locale', currentLang === 'ko' ? 'ko_KR' : 'en_US')
    if (canonicalUrl) setMeta('property', 'og:url', canonicalUrl)

    // OG image with dimensions
    if (ogImage) {
      setMeta('property', 'og:image', ogImage)
      const w = ogImageWidth || SEO.OG_IMAGE_WIDTH
      const h = ogImageHeight || SEO.OG_IMAGE_HEIGHT
      setMeta('property', 'og:image:width', String(w))
      setMeta('property', 'og:image:height', String(h))
    }

    // Article-specific OG meta
    if (ogType === 'article') {
      if (publishedTime) setMeta('property', 'article:published_time', publishedTime)
      if (modifiedTime) setMeta('property', 'article:modified_time', modifiedTime)
      if (articleSection) setMeta('property', 'article:section', articleSection)
    }

    // Twitter Card
    setMeta('name', 'twitter:card', ogImage ? 'summary_large_image' : 'summary')
    setMeta('name', 'twitter:site', SEO.TWITTER_HANDLE)
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    if (ogImage) setMeta('name', 'twitter:image', ogImage)

    // Canonical
    if (canonicalUrl) {
      setLink('canonical', '', canonicalUrl)
    }

    // Hreflang
    const hreflangKeys: string[] = []
    if (hreflangAlternates) {
      for (const alt of hreflangAlternates) {
        setLink('alternate', alt.lang, alt.href)
        hreflangKeys.push(alt.lang)
      }
    }

    // JSON-LD (supports single or multiple schemas)
    const scripts: HTMLScriptElement[] = []
    if (jsonLd) {
      const schemas = Array.isArray(jsonLd) ? jsonLd : [jsonLd]
      for (const schema of schemas) {
        const scriptEl = document.createElement('script')
        scriptEl.type = 'application/ld+json'
        scriptEl.textContent = JSON.stringify(schema)
        document.head.appendChild(scriptEl)
        scripts.push(scriptEl)
      }
    }

    return () => {
      document.title = prevTitle
      document.documentElement.lang = prevLang
      for (const s of scripts) s.remove()
      if (canonicalUrl) removeLink('canonical')
      for (const key of hreflangKeys) {
        removeLink('alternate', key)
      }
      if (ogImage) {
        removeMeta('property', 'og:image:width')
        removeMeta('property', 'og:image:height')
      }
      if (ogType === 'article') {
        removeMeta('property', 'article:published_time')
        removeMeta('property', 'article:modified_time')
        removeMeta('property', 'article:section')
      }
    }
  }, [title, description, ogImage, ogImageWidth, ogImageHeight, ogType, canonicalUrl, jsonLd, hreflangAlternates, publishedTime, modifiedTime, articleSection])
}
