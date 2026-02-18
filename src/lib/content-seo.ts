import i18next from 'i18next'
import type { ContentDetail } from '../types/content-blocks'

const SITE_URL = 'https://reeeeecallstudy.com'

export function buildArticleJsonLd(article: ContentDetail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.meta_title || article.title,
    description: article.meta_description || article.subtitle || '',
    image: article.og_image_url || article.thumbnail_url || `${SITE_URL}/favicon.png`,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: {
      '@type': 'Organization',
      name: article.author_name || 'ReeeCall',
    },
    publisher: {
      '@type': 'Organization',
      name: 'ReeeeecallStudy',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/favicon.png`,
      },
    },
    inLanguage: article.locale,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/content/${article.slug}`,
    },
  }
}

export function buildCollectionPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: i18next.t('content:seo.listTitle'),
    description: i18next.t('content:seo.listDescription'),
    url: `${SITE_URL}/content`,
  }
}

export function buildWebApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'ReeeeecallStudy',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: i18next.t('landing:hero.description', { defaultValue: 'Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm' }),
    url: SITE_URL,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: 'ReeeeecallStudy',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/favicon.png`,
      },
    },
  }
}

export function buildHreflangAlternates(slug: string) {
  return [
    { lang: 'en', href: `${SITE_URL}/content/${slug}?lang=en` },
    { lang: 'ko', href: `${SITE_URL}/content/${slug}?lang=ko` },
    { lang: 'x-default', href: `${SITE_URL}/content/${slug}` },
  ]
}
