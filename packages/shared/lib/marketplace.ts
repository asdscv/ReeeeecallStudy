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
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ListingFilters {
  category?: string
  tags?: string[]
  query?: string
}

export type SortBy = 'newest' | 'popular' | 'card_count'

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
  }
  return sorted
}

export function isListingOwner(
  listing: MarketplaceListingData,
  userId: string,
): boolean {
  return listing.owner_id === userId
}
