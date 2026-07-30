// schema.org JSON-LD type definitions for structured data builders.

// --- Shared fragments ---

export interface JsonLdImageObject {
  '@type': 'ImageObject'
  url: string
  width: number
  height: number
  name?: string
  description?: string
}

export interface JsonLdOrganization {
  '@type': 'Organization'
  name: string
  url: string
  logo?: JsonLdImageObject
}

export interface JsonLdWebPageRef {
  '@type': 'WebPage'
  '@id': string
}

// --- Top-level types ---

export interface JsonLdArticle {
  '@context': 'https://schema.org'
  '@type': 'Article'
  headline: string
  description: string
  image: JsonLdImageObject
  datePublished: string
  dateModified: string
  wordCount: number
  keywords: string
  author: JsonLdOrganization
  publisher: JsonLdOrganization & { logo: JsonLdImageObject }
  url: string
  inLanguage: string
  isAccessibleForFree: boolean
  mainEntityOfPage: JsonLdWebPageRef
  relatedLink?: string[]
}

export interface JsonLdListItem {
  '@type': 'ListItem'
  position: number
  name: string
  item: string
}

export interface JsonLdBreadcrumbList {
  '@context': 'https://schema.org'
  '@type': 'BreadcrumbList'
  itemListElement: JsonLdListItem[]
}

export interface JsonLdCollectionPage {
  '@context': 'https://schema.org'
  '@type': 'CollectionPage'
  name: string
  description: string
  url: string
  image: JsonLdImageObject
  inLanguage: string
  publisher: JsonLdOrganization & { logo: JsonLdImageObject }
  mainEntityOfPage: JsonLdWebPageRef
}

export interface JsonLdOffer {
  '@type': 'Offer'
  price: string
  priceCurrency: string
}

export interface JsonLdWebApplication {
  '@context': 'https://schema.org'
  '@type': 'WebApplication'
  name: string
  applicationCategory: string
  operatingSystem: string
  description: string
  url: string
  image: JsonLdImageObject
  inLanguage: string
  offers: JsonLdOffer
  publisher: JsonLdOrganization & { logo: JsonLdImageObject }
}

export interface JsonLdContactPoint {
  '@type': 'ContactPoint'
  contactType: string
  email: string
  availableLanguage: string[]
}

export interface JsonLdOrganizationFull {
  '@context': 'https://schema.org'
  '@type': 'Organization'
  name: string
  url: string
  logo: JsonLdImageObject
  sameAs: string[]
  contactPoint: JsonLdContactPoint
}

export interface JsonLdSearchAction {
  '@type': 'SearchAction'
  target: string
  'query-input': string
}

export interface JsonLdWebSite {
  '@context': 'https://schema.org'
  '@type': 'WebSite'
  name: string
  url: string
  inLanguage: string[]
  potentialAction: JsonLdSearchAction
}

export interface JsonLdAnswer {
  '@type': 'Answer'
  text: string
}

export interface JsonLdQuestion {
  '@type': 'Question'
  name: string
  acceptedAnswer: JsonLdAnswer
}

export interface JsonLdFAQPage {
  '@context': 'https://schema.org'
  '@type': 'FAQPage'
  mainEntity: JsonLdQuestion[]
}

export interface JsonLdHowToStep {
  '@type': 'HowToStep'
  position: number
  name: string
  text: string
}

export interface JsonLdHowTo {
  '@context': 'https://schema.org'
  '@type': 'HowTo'
  name: string
  totalTime?: string
  step: JsonLdHowToStep[]
}

export interface JsonLdSpeakableSpecification {
  '@type': 'SpeakableSpecification'
  cssSelector: string[]
}

export interface JsonLdLearningResource {
  '@context': 'https://schema.org'
  '@type': 'LearningResource'
  name: string
  description: string
  image: JsonLdImageObject
  datePublished: string
  dateModified: string
  educationalLevel: string
  learningResourceType: string
  timeRequired: string
  keywords: string
  inLanguage: string
  isAccessibleForFree: boolean
  author: JsonLdOrganization
  publisher: JsonLdOrganization & { logo: JsonLdImageObject }
  mainEntityOfPage: JsonLdWebPageRef
  speakable: JsonLdSpeakableSpecification
}

export interface JsonLdHreflangAlternate {
  lang: string
  href: string
}
