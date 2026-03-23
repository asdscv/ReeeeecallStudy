import { useTranslation } from 'react-i18next'
import type { MarketplaceListing, BadgeType } from '../../types/database'
import { StarRatingInline } from './StarRating'
import { OfficialBadge } from '../common/OfficialBadge'

interface ListingCardProps {
  listing: MarketplaceListing & { badge_type?: BadgeType; badge_color?: string }
  onClick: (listing: MarketplaceListing) => void
  isTrending?: boolean
}

const MODE_CLASSES: Record<string, string> = {
  copy: 'bg-teal-50 text-teal-700',
  subscribe: 'bg-purple-50 text-purple-700',
  snapshot: 'bg-orange-50 text-orange-700',
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 text-brand shrink-0 ${className ?? ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-label="Verified publisher"
    >
      <path
        fillRule="evenodd"
        d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function ListingCard({ listing, onClick, isTrending }: ListingCardProps) {
  const { t } = useTranslation('marketplace')
  const modeClassName = MODE_CLASSES[listing.share_mode] ?? MODE_CLASSES.copy

  return (
    <div
      className="bg-card rounded-xl border border-border p-4 hover:border-brand/30 hover:shadow-md transition cursor-pointer"
      onClick={() => onClick(listing)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isTrending && (
            <span className="text-base shrink-0" title={t('trending', { defaultValue: 'Trending' })}>
              {'\uD83D\uDD25'}
            </span>
          )}
          <h3 className="text-base font-semibold text-foreground line-clamp-1">{listing.title}</h3>
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ml-2 ${modeClassName}`}>
          {t(`shareModes.${listing.share_mode}`, listing.share_mode)}
        </span>
      </div>

      {/* Publisher line with verified badge */}
      {listing.owner_display_name && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-xs text-muted-foreground truncate">
            {listing.owner_display_name}
          </span>
          {listing.owner_is_official && (
            <OfficialBadge
              badgeType={listing.badge_type || 'verified'}
              badgeColor={listing.badge_color}
              size="sm"
            />
          )}
        </div>
      )}

      {listing.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{listing.description}</p>
      )}

      {listing.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {listing.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="px-2 py-0.5 text-xs bg-accent text-muted-foreground rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-content-tertiary">
        <div className="flex items-center gap-3">
          <span>{t('listing.cardCount', { count: listing.card_count })}</span>
          <span className="inline-flex items-center gap-0.5">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {listing.view_count ?? 0}
          </span>
          <span>{t('listing.userCount', { count: listing.acquire_count })}</span>
        </div>
        {(listing.review_count ?? 0) > 0 && (
          <StarRatingInline rating={listing.avg_rating ?? 0} count={listing.review_count ?? 0} size="sm" />
        )}
      </div>
    </div>
  )
}
