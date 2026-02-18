import i18next from 'i18next'
import type { ContentDetail } from '../types/content-blocks'
import { SEO } from './seo-config'

export function buildArticleJsonLd(article: ContentDetail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.meta_title || article.title,
    description: article.meta_description || article.subtitle || '',
    image: article.og_image_url || article.thumbnail_url || SEO.DEFAULT_OG_IMAGE,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: {
      '@type': 'Organization',
      name: article.author_name || SEO.AUTHOR_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: SEO.BRAND_NAME,
      logo: {
        '@type': 'ImageObject',
        url: SEO.DEFAULT_OG_IMAGE,
      },
    },
    inLanguage: article.locale,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SEO.SITE_URL}/content/${article.slug}`,
    },
  }
}

export function buildBreadcrumbJsonLd(article: ContentDetail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: SEO.BRAND_NAME,
        item: SEO.SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Learning Insights',
        item: `${SEO.SITE_URL}/content`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: `${SEO.SITE_URL}/content/${article.slug}`,
      },
    ],
  }
}

export function buildCollectionPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: i18next.t('content:seo.listTitle'),
    description: i18next.t('content:seo.listDescription'),
    url: `${SEO.SITE_URL}/content`,
    inLanguage: i18next.language || SEO.DEFAULT_LOCALE,
  }
}

export function buildWebApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SEO.BRAND_NAME,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: i18next.t('landing:hero.description', { defaultValue: 'Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm' }),
    url: SEO.SITE_URL,
    inLanguage: i18next.language || SEO.DEFAULT_LOCALE,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: SEO.BRAND_NAME,
      logo: {
        '@type': 'ImageObject',
        url: SEO.DEFAULT_OG_IMAGE,
      },
    },
  }
}

export function buildHreflangAlternates(slug: string) {
  return [
    { lang: 'en', href: `${SEO.SITE_URL}/content/${slug}?lang=en` },
    { lang: 'ko', href: `${SEO.SITE_URL}/content/${slug}?lang=ko` },
    { lang: 'x-default', href: `${SEO.SITE_URL}/content/${slug}` },
  ]
}
