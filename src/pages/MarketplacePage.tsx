import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarketplaceStore } from '../stores/marketplace-store'
import { ListingCard } from '../components/marketplace/ListingCard'
import { SearchFilters } from '../components/marketplace/SearchFilters'
import type { MarketplaceListing } from '../types/database'

export function MarketplacePage() {
  const navigate = useNavigate()
  const { loading, filters, fetchListings, setFilters, getFilteredListings } = useMarketplaceStore()

  useEffect(() => {
    fetchListings()
  }, [fetchListings])

  const filteredListings = getFilteredListings()

  const handleListingClick = (listing: MarketplaceListing) => {
    navigate(`/marketplace/${listing.id}`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">마켓플레이스</h1>
      </div>

      <div className="mb-4">
        <SearchFilters
          query={filters.query ?? ''}
          category={filters.category ?? ''}
          sortBy={filters.sortBy}
          onQueryChange={(query) => setFilters({ query })}
          onCategoryChange={(category) => setFilters({ category: category || undefined })}
          onSortChange={(sortBy) => setFilters({ sortBy })}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">🏪</div>
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">🏪</div>
          <p className="text-gray-500 text-sm sm:text-base">
            {filters.query || filters.category
              ? '검색 결과가 없습니다.'
              : '아직 게시된 덱이 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onClick={handleListingClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
