import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMarketplaceStore } from '../stores/marketplace-store'
import { ListingCard } from '../components/marketplace/ListingCard'
import { SearchFilters } from '../components/marketplace/SearchFilters'
import type { MarketplaceListing } from '../types/database'

const PAGE_SIZE = 12

export function MarketplacePage() {
  const navigate = useNavigate()
  const { loading, filters, fetchListings, setFilters, getFilteredListings } = useMarketplaceStore()
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    fetchListings()
  }, [fetchListings])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [filters.query, filters.category, filters.sortBy])

  const filteredListings = getFilteredListings()

  const totalPages = Math.max(1, Math.ceil(filteredListings.length / PAGE_SIZE))
  const safePage = Math.max(1, Math.min(currentPage, totalPages))
  const startIdx = (safePage - 1) * PAGE_SIZE
  const pageListings = filteredListings.slice(startIdx, startIdx + PAGE_SIZE)

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
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {pageListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={handleListingClick}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 sm:px-4 py-3 mt-4 sm:mt-6 bg-white rounded-xl border border-gray-200">
              <span className="text-xs sm:text-sm text-gray-500">
                {startIdx + 1}~{Math.min(startIdx + PAGE_SIZE, filteredListings.length)} / {filteredListings.length}개
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                  className="p-2 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let page: number
                  if (totalPages <= 5) {
                    page = i + 1
                  } else if (safePage <= 3) {
                    page = i + 1
                  } else if (safePage >= totalPages - 2) {
                    page = totalPages - 4 + i
                  } else {
                    page = safePage - 2 + i
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-9 h-9 text-sm rounded cursor-pointer ${
                        safePage === page
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      {page}
                    </button>
                  )
                })}
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage >= totalPages}
                  className="p-2 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
