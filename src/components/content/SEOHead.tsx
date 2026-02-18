import { useSEO } from '../../hooks/useSEO'

interface SEOHeadProps {
  title: string
  description: string
  ogImage?: string
  ogType?: 'article' | 'website'
  canonicalUrl?: string
  jsonLd?: object
  hreflangAlternates?: Array<{ lang: string; href: string }>
}

export function SEOHead(props: SEOHeadProps) {
  useSEO(props)
  return null
}
