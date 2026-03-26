import {
  SITE_URL,
  BRAND_NAME,
  DEFAULT_OG_IMAGE,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  SUPPORTED_LOCALES,
} from './constants.js'
import { buildPublisherJsonLd } from './helpers.js'

export function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    sameAs: [
      'https://twitter.com/reeeeecallstudy',
      'https://x.com/reeeeecallstudy',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: 'admin@reeeeecallstudy.xyz',
      availableLanguage: ['English', 'Korean', 'Chinese', 'Japanese', 'Spanish', 'Vietnamese', 'Thai', 'Indonesian'],
    },
  }
}

export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND_NAME,
    url: SITE_URL,
    inLanguage: SUPPORTED_LOCALES,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/insight?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildArticleJsonLd(article, slug) {
  const title = article.meta_title || article.title
  const description = article.meta_description || article.subtitle || ''
  const ogImage = article.og_image_url || article.thumbnail_url || DEFAULT_OG_IMAGE
  const tags = article.tags || []
  const wordCount = Math.round((article.reading_time_minutes || 5) * 250)
  const locale = article.locale || 'en'
  const langSuffix = locale !== 'en' ? `?lang=${locale}` : ''

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    image: { '@type': 'ImageObject', url: ogImage, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    datePublished: article.published_at,
    dateModified: article.updated_at,
    wordCount,
    keywords: tags.join(', '),
    author: { '@type': 'Organization', name: article.author_name || BRAND_NAME, url: SITE_URL },
    publisher: buildPublisherJsonLd(),
    inLanguage: locale,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight/${slug}${langSuffix}` },
  }
}

export function buildBreadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

export function buildLearningResourceJsonLd(article, slug) {
  const title = article.meta_title || article.title
  const description = article.meta_description || article.subtitle || ''
  const ogImage = article.og_image_url || article.thumbnail_url || DEFAULT_OG_IMAGE
  const tags = article.tags || []
  const locale = article.locale || 'en'
  const langSuffix = locale !== 'en' ? `?lang=${locale}` : ''

  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: title,
    description,
    image: { '@type': 'ImageObject', url: ogImage, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    datePublished: article.published_at,
    dateModified: article.updated_at,
    educationalLevel: 'beginner',
    learningResourceType: 'Article',
    timeRequired: `PT${article.reading_time_minutes || 5}M`,
    keywords: tags.join(', '),
    inLanguage: locale,
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: article.author_name || BRAND_NAME, url: SITE_URL },
    publisher: buildPublisherJsonLd(),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight/${slug}${langSuffix}` },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['article h1', 'article h2', 'article p', 'article li', 'article blockquote'],
    },
  }
}

export function buildCollectionPageJsonLd(title, desc, lang, count) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: desc,
    url: `${SITE_URL}/insight`,
    image: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    inLanguage: lang,
    numberOfItems: count,
    publisher: buildPublisherJsonLd(),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight` },
  }
}

export function buildItemListJsonLd(articles) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: articles.slice(0, 30).map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/insight/${a.slug}`,
      name: a.title,
    })),
  }
}

export function buildWebAppJsonLd(desc, lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: BRAND_NAME,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: desc,
    url: SITE_URL,
    image: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    inLanguage: lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: buildPublisherJsonLd(),
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: '150',
      bestRating: '5',
    },
  }
}

export function buildFAQJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

export function buildHowToJsonLd(name, steps, totalTime) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    totalTime,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  }
}

export function buildCourseJsonLd(lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: lang === 'ko' ? '간격 반복 학습 마스터하기' : 'Master Spaced Repetition Learning',
    description: lang === 'ko'
      ? '과학적으로 검증된 간격 반복(SRS) 알고리즘으로 어떤 과목이든 더 빠르게 암기하고 오래 기억하세요.'
      : 'Learn to memorize any subject faster and retain it longer with scientifically proven spaced repetition (SRS) algorithm.',
    provider: { '@type': 'Organization', name: BRAND_NAME, url: SITE_URL },
    isAccessibleForFree: true,
    courseMode: 'online',
    inLanguage: SUPPORTED_LOCALES,
    educationalLevel: 'beginner',
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      courseWorkload: 'PT5M',
    },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
  }
}

export function buildProfilePageJsonLd(desc, lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      description: desc,
      logo: DEFAULT_OG_IMAGE,
      sameAs: ['https://twitter.com/reeeeecallstudy', 'https://x.com/reeeeecallstudy'],
    },
    hasPart: [
      { '@type': 'Article', url: `${SITE_URL}/insight`, name: lang === 'ko' ? '학습 인사이트' : 'Learning Insights' },
    ],
  }
}

export function buildDatasetJsonLd(listing, listingId, lang) {
  const description = listing.description || `${listing.title} — ${listing.card_count || 0} ${lang === 'ko' ? '장의 카드가 포함된 플래시카드 덱' : 'cards flashcard deck on'} ${BRAND_NAME}`
  const tags = listing.tags || []

  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: listing.title,
    description,
    url: `${SITE_URL}/d/${listingId}`,
    keywords: tags.join(', '),
    creator: {
      '@type': listing.owner_is_official ? 'Organization' : 'Person',
      name: listing.owner_name || BRAND_NAME,
    },
    publisher: buildPublisherJsonLd(),
    datePublished: listing.created_at,
    inLanguage: lang,
    isAccessibleForFree: true,
  }
}
