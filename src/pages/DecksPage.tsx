import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { DeckCard } from '../components/deck/DeckCard'
import { DeckFormModal } from '../components/deck/DeckFormModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import type { Deck } from '../types/database'

export function DecksPage() {
  const { t } = useTranslation(['decks', 'common'])
  const { user } = useAuthStore()
  const { decks, stats, templates, loading, fetchDecks, fetchStats, fetchTemplates, deleteDeck } = useDeckStore()

  const [showCreate, setShowCreate] = useState(false)
  const [deletingDeck, setDeletingDeck] = useState<Deck | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    fetchDecks()
    fetchTemplates()
    if (user) fetchStats(user.id)
  }, [fetchDecks, fetchStats, fetchTemplates, user])

  const handleDelete = async () => {
    if (!deletingDeck) return
    setDeleteLoading(true)
    await deleteDeck(deletingDeck.id)
    setDeleteLoading(false)
    setDeletingDeck(null)
  }

  const getStatsForDeck = (deckId: string) => {
    return stats.find((s) => s.deck_id === deckId)
  }

  const getTemplateName = (templateId: string | null) => {
    if (!templateId) return undefined
    return templates.find((t) => t.id === templateId)?.name
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('decks:title')}</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
        >
          {t('decks:createNew')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">📚</div>
        </div>
      ) : decks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">📚</div>
          <p className="text-gray-500 mb-4 text-sm sm:text-base">{t('decks:empty')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            {t('decks:createFirst')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              stats={getStatsForDeck(deck.id)}
              templateName={getTemplateName(deck.default_template_id)}
              onDelete={setDeletingDeck}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <DeckFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deletingDeck}
        onClose={() => setDeletingDeck(null)}
        onConfirm={handleDelete}
        title={t('decks:deleteDeck')}
        message={t('decks:deleteConfirm', { name: deletingDeck?.name })}
        confirmLabel={t('common:actions.delete')}
        danger
        loading={deleteLoading}
      />
    </div>
  )
}
