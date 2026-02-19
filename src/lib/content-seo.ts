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
    wordCount: Math.round(article.reading_time_minutes * 250),
    keywords: article.tags.join(', '),
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
        width: SEO.OG_IMAGE_WIDTH,
        height: SEO.OG_IMAGE_HEIGHT,
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
    image: SEO.DEFAULT_OG_IMAGE,
    inLanguage: i18next.language || SEO.DEFAULT_LOCALE,
    publisher: {
      '@type': 'Organization',
      name: SEO.BRAND_NAME,
      logo: {
        '@type': 'ImageObject',
        url: SEO.DEFAULT_OG_IMAGE,
        width: SEO.OG_IMAGE_WIDTH,
        height: SEO.OG_IMAGE_HEIGHT,
      },
    },
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
        width: SEO.OG_IMAGE_WIDTH,
        height: SEO.OG_IMAGE_HEIGHT,
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

export function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SEO.BRAND_NAME,
    url: SEO.SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: SEO.DEFAULT_OG_IMAGE,
      width: SEO.OG_IMAGE_WIDTH,
      height: SEO.OG_IMAGE_HEIGHT,
    },
    sameAs: [
      `https://twitter.com/${SEO.TWITTER_HANDLE.replace('@', '')}`,
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: ['English', 'Korean'],
    },
  }
}

export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SEO.BRAND_NAME,
    url: SEO.SITE_URL,
    inLanguage: ['en', 'ko'],
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SEO.SITE_URL}/content?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildFAQJsonLd(questions: Array<{ question: string; answer: string }>) {
  if (questions.length === 0) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  }
}

export function buildHowToJsonLd(
  name: string,
  steps: Array<{ name: string; text: string }>,
  totalTime?: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    ...(totalTime && { totalTime }),
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  }
}

export function buildLearningResourceJsonLd(article: ContentDetail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: article.meta_title || article.title,
    description: article.meta_description || article.subtitle || '',
    image: article.og_image_url || article.thumbnail_url || SEO.DEFAULT_OG_IMAGE,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    educationalLevel: 'beginner',
    learningResourceType: 'Article',
    timeRequired: `PT${article.reading_time_minutes}M`,
    keywords: article.tags.join(', '),
    inLanguage: article.locale,
    isAccessibleForFree: true,
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
        width: SEO.OG_IMAGE_WIDTH,
        height: SEO.OG_IMAGE_HEIGHT,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SEO.SITE_URL}/content/${article.slug}`,
    },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['article h1', 'article h2', 'article p'],
    },
  }
}
