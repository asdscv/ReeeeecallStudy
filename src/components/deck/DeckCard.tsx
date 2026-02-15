import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical } from 'lucide-react'
import { formatRelativeTime } from '../../lib/date-utils'
import type { Deck } from '../../types/database'

interface DeckStats {
  total_cards: number
  new_cards: number
  review_cards: number
  learning_cards: number
  last_studied: string | null
}

interface DeckCardProps {
  deck: Deck
  stats?: DeckStats
  onDelete: (deck: Deck) => void
}

export function DeckCard({ deck, stats, onDelete }: DeckCardProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const totalCards = stats?.total_cards ?? 0
  const dueCards = (stats?.review_cards ?? 0) + (stats?.learning_cards ?? 0)
  const newCards = stats?.new_cards ?? 0

  const formatLastStudied = (dateStr: string | null) => {
    if (!dateStr) return '학습 기록 없음'
    return formatRelativeTime(dateStr)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition relative flex">
      {/* Left color bar */}
      <div
        className="w-1 shrink-0 rounded-l-xl"
        style={{ backgroundColor: deck.color }}
      />

      <div className="flex-1 p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate(`/decks/${deck.id}`)}
          >
            <span className="text-2xl">{deck.icon}</span>
            <h3 className="text-lg font-semibold text-gray-900">{deck.name}</h3>
          </div>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-32">
                  <button
                    onClick={() => { setMenuOpen(false); navigate(`/decks/${deck.id}/edit`) }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(deck) }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {deck.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-1">{deck.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span>{totalCards}장</span>
          {newCards > 0 && (
            <span className="text-blue-600">새 카드 {newCards}</span>
          )}
          {dueCards > 0 && (
            <span className="text-amber-600">복습 {dueCards}</span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            {formatLastStudied(stats?.last_studied ?? null)}
          </span>
          <button
            onClick={() => navigate(`/decks/${deck.id}/study/setup`)}
            className="px-4 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition cursor-pointer"
          >
            학습 시작
          </button>
        </div>
      </div>
    </div>
  )
}
