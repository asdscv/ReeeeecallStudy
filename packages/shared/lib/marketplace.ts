export interface MarketplaceListingData {
  id: string
  deck_id: string
  owner_id: string
  title: string
  description: string | null
  tags: string[]
  category: string
  share_mode: string
  card_count: number
  acquire_count: number
  avg_rating?: number
  review_count?: number
  is_active: boolean
  created_at: string
  updated_at: string
  owner_display_name?: string | null
  owner_is_official?: boolean
  difficulty_level?: string | null
}

export interface ListingFilters {
  category?: string
  tags?: string[]
  query?: string
  minRating?: number
  minCardCount?: number
  shareMode?: string
  dateRange?: '7d' | '30d' | '90d' | 'all'
  verifiedOnly?: boolean
  difficulty?: string
}

export const DIFFICULTY_LEVELS = [
  { value: 'beginner', labelKey: 'marketplace:difficulty.beginner' },
  { value: 'intermediate', labelKey: 'marketplace:difficulty.intermediate' },
  { value: 'advanced', labelKey: 'marketplace:difficulty.advanced' },
  { value: 'expert', labelKey: 'marketplace:difficulty.expert' },
] as const

export type SortBy = 'newest' | 'popular' | 'card_count' | 'top_rated' | 'trending'

export const MARKETPLACE_CATEGORIES = [
  { value: 'general', labelKey: 'marketplace:categories.general' },
  { value: 'language', labelKey: 'marketplace:categories.language' },
  { value: 'science', labelKey: 'marketplace:categories.science' },
  { value: 'math', labelKey: 'marketplace:categories.math' },
  { value: 'history', labelKey: 'marketplace:categories.history' },
  { value: 'programming', labelKey: 'marketplace:categories.programming' },
  { value: 'trivia', labelKey: 'marketplace:categories.trivia' },
  { value: 'exam', labelKey: 'marketplace:categories.exam' },
  { value: 'other', labelKey: 'marketplace:categories.other' },
] as const

export const SHARE_MODES = ['copy', 'subscribe', 'snapshot'] as const

export const DATE_RANGE_OPTIONS = ['7d', '30d', '90d', 'all'] as const

const DATE_RANGE_MS: Record<string, number> = {
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
}

/**
 * Trending score = acquire_count / (days_since_created + 2)^1.5
 * Favors recent popular decks over old ones with accumulated downloads.
 */
export function calculateTrendingScore(listing: MarketplaceListingData): number {
  const daysSinceCreated = (Date.now() - new Date(listing.created_at).getTime()) / 86400000
  return listing.acquire_count / Math.pow(daysSinceCreated + 2, 1.5)
}

/** Number of active advanced filters (excluding query, category, sortBy) */
export function countActiveFilters(filters: ListingFilters): number {
  let count = 0
  if (filters.minCardCount && filters.minCardCount > 0) count++
  if (filters.shareMode) count++
  if (filters.dateRange && filters.dateRange !== 'all') count++
  if (filters.verifiedOnly) count++
  if (filters.minRating && filters.minRating > 0) count++
  if (filters.tags && filters.tags.length > 0) count++
  if (filters.difficulty) count++
  return count
}

/** Extract unique tags from all listings, sorted by frequency */
export function extractPopularTags(
  listings: MarketplaceListingData[],
  limit = 20,
): string[] {
  const tagCounts = new Map<string, number>()
  for (const listing of listings) {
    for (const tag of listing.tags) {
      const lower = tag.toLowerCase()
      tagCounts.set(lower, (tagCounts.get(lower) ?? 0) + 1)
    }
  }
  return Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag)
}

/** Threshold: top 10% trending score qualifies as "trending" */
export function getTrendingListingIds(
  listings: MarketplaceListingData[],
  topPercent = 0.1,
): Set<string> {
  if (listings.length === 0) return new Set()
  const scored = listings.map((l) => ({ id: l.id, score: calculateTrendingScore(l) }))
  scored.sort((a, b) => b.score - a.score)
  const cutoff = Math.max(1, Math.ceil(listings.length * topPercent))
  return new Set(scored.slice(0, cutoff).map((s) => s.id))
}

export function filterListings(
  listings: MarketplaceListingData[],
  filters: ListingFilters,
): MarketplaceListingData[] {
  return listings.filter((listing) => {
    if (filters.category && listing.category !== filters.category) return false

    if (filters.query) {
      const q = filters.query.toLowerCase()
      const matchesTitle = listing.title.toLowerCase().includes(q)
      const matchesDesc = listing.description?.toLowerCase().includes(q) ?? false
      const matchesTags = listing.tags.some((t) => t.toLowerCase().includes(q))
      if (!matchesTitle && !matchesDesc && !matchesTags) return false
    }

    if (filters.tags && filters.tags.length > 0) {
      const hasMatchingTag = filters.tags.some((ft) =>
        listing.tags.some((lt) => lt.toLowerCase() === ft.toLowerCase()),
      )
      if (!hasMatchingTag) return false
    }

    if (filters.minRating && filters.minRating > 0) {
      if ((listing.avg_rating ?? 0) < filters.minRating) return false
    }

    if (filters.minCardCount && filters.minCardCount > 0) {
      if (listing.card_count < filters.minCardCount) return false
    }

    if (filters.shareMode) {
      if (listing.share_mode !== filters.shareMode) return false
    }

    if (filters.difficulty) {
      if (listing.difficulty_level !== filters.difficulty) return false
    }

    if (filters.dateRange && filters.dateRange !== 'all') {
      const ms = DATE_RANGE_MS[filters.dateRange]
      if (ms) {
        const createdMs = new Date(listing.created_at).getTime()
        if (Date.now() - createdMs > ms) return false
      }
    }

    if (filters.verifiedOnly) {
      if (!listing.owner_is_official) return false
    }

    return true
  })
}

export function sortListings(
  listings: MarketplaceListingData[],
  sortBy: SortBy,
): MarketplaceListingData[] {
  const sorted = [...listings]
  switch (sortBy) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      break
    case 'popular':
      sorted.sort((a, b) => b.acquire_count - a.acquire_count)
      break
    case 'card_count':
      sorted.sort((a, b) => b.card_count - a.card_count)
      break
    case 'top_rated':
      sorted.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || (b.review_count ?? 0) - (a.review_count ?? 0))
      break
    case 'trending':
      sorted.sort((a, b) => calculateTrendingScore(b) - calculateTrendingScore(a))
      break
  }
  return sorted
}

export function isListingOwner(
  listing: MarketplaceListingData,
  userId: string,
): boolean {
  return listing.owner_id === userId
}
