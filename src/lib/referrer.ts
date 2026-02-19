export type ReferrerCategory = 'direct' | 'search' | 'social' | 'internal' | 'other'

export interface ReferrerInfo {
  domain: string
  category: ReferrerCategory
}

const SEARCH_DOMAINS = [
  'google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex',
  'naver', 'daum', 'ecosia', 'ask.com',
]

const SOCIAL_DOMAINS = [
  'facebook', 'twitter', 't.co', 'instagram', 'linkedin',
  'reddit', 'youtube', 'tiktok', 'pinterest', 'tumblr',
  'threads.net', 'mastodon',
]

/**
 * Extract hostname from a URL string. Returns '' for invalid URLs.
 */
export function extractDomain(url: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Categorize a referrer URL into direct/search/social/internal/other.
 */
export function categorizeReferrer(referrer: string, ownDomain?: string): ReferrerInfo {
  const domain = extractDomain(referrer)
  if (!domain) return { domain: '', category: 'direct' }

  // Internal check
  if (ownDomain && domain.includes(ownDomain)) {
    return { domain, category: 'internal' }
  }

  const lower = domain.toLowerCase()

  if (SEARCH_DOMAINS.some((s) => lower.includes(s))) {
    return { domain, category: 'search' }
  }

  if (SOCIAL_DOMAINS.some((s) => lower.includes(s))) {
    return { domain, category: 'social' }
  }

  return { domain, category: 'other' }
}
