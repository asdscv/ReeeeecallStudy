import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMarketplaceStore } from '../stores/marketplace-store'
import { useAuthStore } from '../stores/auth-store'
import type { MarketplaceListing, Card, CardTemplate } from '../types/database'

const MODE_LABELS: Record<string, string> = {
  copy: '복사',
  subscribe: '구독',
  snapshot: '스냅샷',
}

export function MarketplaceDetailPage() {
  const { listingId } = useParams<{ listingId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { acquireDeck, error } = useMarketplaceStore()

  const [listing, setListing] = useState<MarketplaceListing | null>(null)
  const [previewCards, setPreviewCards] = useState<Card[]>([])
  const [template, setTemplate] = useState<CardTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [acquiring, setAcquiring] = useState(false)

  useEffect(() => {
    if (!listingId) return

    const fetchData = async () => {
      setLoading(true)

      const { data: listingData } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('id', listingId)
        .single()

      if (!listingData) {
        navigate('/marketplace', { replace: true })
        return
      }

      const typedListing = listingData as MarketplaceListing
      setListing(typedListing)

      // Fetch preview cards (first 10)
      const { data: cards } = await supabase
        .from('cards')
        .select('*')
        .eq('deck_id', typedListing.deck_id)
        .order('sort_position', { ascending: true })
        .limit(10)

      setPreviewCards((cards ?? []) as Card[])

      // Fetch template
      const { data: deck } = await supabase
        .from('decks')
        .select('default_template_id')
        .eq('id', typedListing.deck_id)
        .single()

      if (deck && (deck as { default_template_id: string | null }).default_template_id) {
        const { data: tmpl } = await supabase
          .from('card_templates')
          .select('*')
          .eq('id', (deck as { default_template_id: string }).default_template_id)
          .single()
        setTemplate(tmpl as CardTemplate | null)
      }

      setLoading(false)
    }

    fetchData()
  }, [listingId, navigate])

  const handleAcquire = async () => {
    if (!listingId) return
    setAcquiring(true)
    const result = await acquireDeck(listingId)
    setAcquiring(false)

    if (result) {
      navigate(`/decks/${result.deckId}`)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">🏪</div>
      </div>
    )
  }

  if (!listing) return null

  const isOwner = user?.id === listing.owner_id
  const displayFields = template?.fields ?? []

  return (
    <div>
      <button
        onClick={() => navigate('/marketplace')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 cursor-pointer"
      >
        ← 마켓플레이스
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 mb-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{listing.title}</h1>
          <span className="px-3 py-1 text-sm bg-blue-50 text-blue-700 rounded-full shrink-0 ml-3">
            {MODE_LABELS[listing.share_mode] ?? listing.share_mode}
          </span>
        </div>

        {listing.description && (
          <p className="text-sm sm:text-base text-gray-600 mb-4">{listing.description}</p>
        )}

        {listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {listing.tags.map((tag) => (
              <span key={tag} className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span>{listing.card_count}장</span>
          <span>{listing.acquire_count}명 사용 중</span>
          <span>{listing.category}</span>
        </div>

        {!isOwner && (
          <button
            onClick={handleAcquire}
            disabled={acquiring}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
          >
            {acquiring ? '가져오는 중...' : '이 덱 가져오기'}
          </button>
        )}

        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Card preview */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium text-gray-700">카드 미리보기 (최대 10장)</h2>
        </div>

        {previewCards.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">카드가 없습니다.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {previewCards.map((card, i) => (
              <div key={card.id} className="px-4 py-3">
                <span className="text-xs text-gray-400 mr-2">#{i + 1}</span>
                {displayFields.slice(0, 3).map((field) => (
                  <span key={field.key} className="text-sm text-gray-700 mr-4">
                    <span className="text-xs text-gray-400">{field.name}: </span>
                    {card.field_values[field.key] || '-'}
                  </span>
                ))}
                {displayFields.length === 0 && (
                  <span className="text-sm text-gray-700">
                    {Object.values(card.field_values).slice(0, 2).join(' / ') || '-'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
