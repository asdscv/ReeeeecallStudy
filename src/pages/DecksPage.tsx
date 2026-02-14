import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { DeckCard } from '../components/deck/DeckCard'
import { DeckFormModal } from '../components/deck/DeckFormModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import type { Deck } from '../types/database'

export function DecksPage() {
  const { user } = useAuthStore()
  const { decks, stats, loading, fetchDecks, fetchStats, fetchTemplates, deleteDeck } = useDeckStore()

  const [showCreate, setShowCreate] = useState(false)
  const [editDeck, setEditDeck] = useState<Deck | null>(null)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">내 덱</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
        >
          + 새 덱 만들기
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">📚</div>
        </div>
      ) : decks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-gray-500 mb-4">아직 덱이 없습니다. 새 덱을 만들어보세요.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            + 첫 번째 덱 만들기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              stats={getStatsForDeck(deck.id)}
              onEdit={setEditDeck}
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

      {/* Edit Modal */}
      <DeckFormModal
        open={!!editDeck}
        onClose={() => setEditDeck(null)}
        editDeck={editDeck}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deletingDeck}
        onClose={() => setDeletingDeck(null)}
        onConfirm={handleDelete}
        title="덱 삭제"
        message={`"${deletingDeck?.name}" 덱과 모든 카드가 삭제됩니다. 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        danger
        loading={deleteLoading}
      />
    </div>
  )
}
