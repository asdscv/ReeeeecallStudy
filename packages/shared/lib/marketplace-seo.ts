import i18next from 'i18next'
import type { PublicListingPreview } from '../types/database'
import { SEO } from './seo-config'

export function buildListingDatasetJsonLd(listing: PublicListingPreview) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: listing.title,
    description: listing.description || i18next.t('marketplace:preview.defaultDescription'),
    url: `${SEO.SITE_URL}/d/${listing.id}`,
    keywords: listing.tags.join(', '),
    creator: {
      '@type': listing.owner_is_official ? 'Organization' : 'Person',
      name: listing.owner_name || SEO.BRAND_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: SEO.BRAND_NAME,
      url: SEO.SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: SEO.DEFAULT_OG_IMAGE,
        width: SEO.OG_IMAGE_WIDTH,
        height: SEO.OG_IMAGE_HEIGHT,
      },
    },
    datePublished: listing.created_at,
    inLanguage: i18next.language || SEO.DEFAULT_LOCALE,
    isAccessibleForFree: true,
  }
}

export function buildListingBreadcrumbJsonLd(listing: PublicListingPreview) {
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
        name: i18next.t('marketplace:title'),
        item: `${SEO.SITE_URL}/landing`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: listing.title,
        item: `${SEO.SITE_URL}/d/${listing.id}`,
      },
    ],
  }
}

export function buildListingHreflangAlternates(listingId: string) {
  const alternates: { lang: string; href: string }[] = SEO.SUPPORTED_LOCALES.map((locale) => ({
    lang: locale as string,
    href: `${SEO.SITE_URL}/d/${listingId}?lang=${locale}`,
  }))
  alternates.push({ lang: 'x-default', href: `${SEO.SITE_URL}/d/${listingId}` })
  return alternates
}
