import { useEffect } from 'react'

interface SEOOptions {
  title: string
  description: string
  ogImage?: string
  ogType?: 'article' | 'website'
  canonicalUrl?: string
  jsonLd?: object
  hreflangAlternates?: Array<{ lang: string; href: string }>
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

function setLink(rel: string, key: string, href: string) {
  const selector = key ? `link[rel="${rel}"][hreflang="${key}"]` : `link[rel="${rel}"]`
  let el = document.querySelector(selector) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    if (key) el.hreflang = key
    document.head.appendChild(el)
  }
  el.href = href
}

export function useSEO(options: SEOOptions) {
  const {
    title,
    description,
    ogImage,
    ogType = 'website',
    canonicalUrl,
    jsonLd,
    hreflangAlternates,
  } = options

  useEffect(() => {
    // Title
    const prevTitle = document.title
    document.title = title

    // Description
    setMeta('name', 'description', description)

    // Open Graph
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:type', ogType)
    if (ogImage) setMeta('property', 'og:image', ogImage)
    if (canonicalUrl) setMeta('property', 'og:url', canonicalUrl)

    // Twitter Card
    setMeta('name', 'twitter:card', ogImage ? 'summary_large_image' : 'summary')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    if (ogImage) setMeta('name', 'twitter:image', ogImage)

    // Canonical
    if (canonicalUrl) {
      setLink('canonical', '', canonicalUrl)
    }

    // Hreflang
    if (hreflangAlternates) {
      for (const alt of hreflangAlternates) {
        setLink('alternate', alt.lang, alt.href)
      }
    }

    // JSON-LD
    let scriptEl: HTMLScriptElement | null = null
    if (jsonLd) {
      scriptEl = document.createElement('script')
      scriptEl.type = 'application/ld+json'
      scriptEl.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(scriptEl)
    }

    return () => {
      document.title = prevTitle
      if (scriptEl) scriptEl.remove()
    }
  }, [title, description, ogImage, ogType, canonicalUrl, jsonLd, hreflangAlternates])
}
