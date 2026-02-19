import { useSEO } from '../../hooks/useSEO'

interface SEOHeadProps {
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
  keywords?: string[]
  articleTags?: string[]
  noIndex?: boolean
}

export function SEOHead(props: SEOHeadProps) {
  useSEO(props)
  return null
}
