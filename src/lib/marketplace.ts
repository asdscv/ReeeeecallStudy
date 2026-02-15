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
  { value: 'general', label: '일반' },
  { value: 'language', label: '언어' },
  { value: 'science', label: '과학' },
  { value: 'math', label: '수학' },
  { value: 'history', label: '역사' },
  { value: 'programming', label: '프로그래밍' },
  { value: 'trivia', label: '상식' },
  { value: 'exam', label: '시험 준비' },
  { value: 'other', label: '기타' },
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
