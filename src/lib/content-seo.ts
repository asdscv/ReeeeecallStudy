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

export function buildCollectionPageJsonLd(locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: locale === 'ko' ? '학습 인사이트 | ReeeCall' : 'Learning Insights | ReeeCall',
    description:
      locale === 'ko'
        ? '과학적으로 검증된 학습 전략과 간격 반복 팁을 알아보세요.'
        : 'Discover science-backed learning strategies and spaced repetition tips.',
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
    description: 'Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm',
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
