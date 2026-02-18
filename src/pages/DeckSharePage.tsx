import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useSharingStore } from '../stores/sharing-store'
import { ShareModal } from '../components/sharing/ShareModal'
import { SubscriberList } from '../components/sharing/SubscriberList'
import { PublishModal } from '../components/marketplace/PublishModal'
import { useMarketplaceStore } from '../stores/marketplace-store'
import type { Deck } from '../types/database'

export function DeckSharePage() {
  const { t } = useTranslation('sharing')
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const { myShares, fetchMyShares, revokeShare } = useSharingStore()
  const { myListings, fetchMyListings, unpublishDeck } = useMarketplaceStore()

  const [deck, setDeck] = useState<Deck | null>(null)
  const [loading, setLoading] = useState(true)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)

  useEffect(() => {
    if (!deckId) return

    const fetchData = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('decks')
        .select('*')
        .eq('id', deckId)
        .single()

      if (!data) {
        navigate('/decks', { replace: true })
        return
      }
      setDeck(data as Deck)
      await fetchMyShares()
      await fetchMyListings()
      setLoading(false)
    }

    fetchData()
  }, [deckId, navigate, fetchMyShares, fetchMyListings])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📤</div>
      </div>
    )
  }

  if (!deck) return null

  const deckShares = myShares.filter((s) => s.deck_id === deckId)
  const deckListing = myListings.find((l) => l.deck_id === deckId)

  return (
    <div>
      <button
        onClick={() => navigate(`/decks/${deckId}`)}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 cursor-pointer"
      >
        ← {deck.name}
      </button>

      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">{t('deckShare.title')}</h1>

      {/* Direct sharing */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">{t('deckShare.directSharing')}</h2>
          <button
            onClick={() => setShowShareModal(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            + {t('deckShare.createShareLink')}
          </button>
        </div>

        <SubscriberList
          shares={deckShares}
          onRevoke={revokeShare}
        />
      </section>

      {/* Marketplace */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">{t('deckShare.marketplace')}</h2>
        </div>

        {deckListing ? (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{deckListing.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('deckShare.usersUsing', { count: deckListing.acquire_count })} · {deckListing.is_active ? t('deckShare.active') : t('deckShare.inactive')}
                </p>
              </div>
              <button
                onClick={() => unpublishDeck(deckListing.id)}
                className="px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition cursor-pointer shrink-0 self-start sm:self-center"
              >
                {t('deckShare.unpublish')}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500 mb-3">{t('deckShare.publishDescription')}</p>
            <button
              onClick={() => setShowPublishModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
            >
              {t('deckShare.publish')}
            </button>
          </div>
        )}
      </section>

      <ShareModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        deckId={deckId!}
        deckName={deck.name}
      />

      <PublishModal
        open={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        deckId={deckId!}
        deckName={deck.name}
      />
    </div>
  )
}
