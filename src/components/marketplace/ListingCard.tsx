import type { MarketplaceListing } from '../../types/database'

interface ListingCardProps {
  listing: MarketplaceListing
  onClick: (listing: MarketplaceListing) => void
}

const MODE_LABELS: Record<string, { label: string; className: string }> = {
  copy: { label: '복사', className: 'bg-teal-50 text-teal-700' },
  subscribe: { label: '구독', className: 'bg-purple-50 text-purple-700' },
  snapshot: { label: '스냅샷', className: 'bg-orange-50 text-orange-700' },
}

export function ListingCard({ listing, onClick }: ListingCardProps) {
  const mode = MODE_LABELS[listing.share_mode] ?? MODE_LABELS.copy

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition cursor-pointer"
      onClick={() => onClick(listing)}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900 line-clamp-1">{listing.title}</h3>
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ml-2 ${mode.className}`}>
          {mode.label}
        </span>
      </div>

      {listing.description && (
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{listing.description}</p>
      )}

      {listing.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {listing.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100 text-xs text-gray-400">
        <span>{listing.card_count}장</span>
        <span>{listing.acquire_count}명 사용 중</span>
      </div>
    </div>
  )
}
