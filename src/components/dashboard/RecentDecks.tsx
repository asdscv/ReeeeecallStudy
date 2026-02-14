import { useNavigate } from 'react-router-dom'
import type { Deck } from '../../types/database'

interface DeckStat {
  deck_id: string
  total_cards: number
  new_cards: number
  review_cards: number
  learning_cards: number
}

interface RecentDecksProps {
  decks: Deck[]
  stats: DeckStat[]
}

export function RecentDecks({ decks, stats }: RecentDecksProps) {
  const navigate = useNavigate()

  if (decks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="text-5xl mb-4">📚</div>
        <p className="text-gray-500 mb-4">아직 덱이 없습니다. 덱을 만들어보세요!</p>
        <button
          onClick={() => navigate('/decks')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
        >
          덱 관리로 이동
        </button>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-3">덱 현황</h3>
      <div className="grid gap-3">
        {decks.map((deck) => {
          const deckStat = stats.find((s) => s.deck_id === deck.id)
          const total = deckStat?.total_cards ?? 0
          const newCards = deckStat?.new_cards ?? 0
          const review = (deckStat?.review_cards ?? 0) + (deckStat?.learning_cards ?? 0)

          return (
            <div
              key={deck.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition cursor-pointer"
              onClick={() => navigate(`/decks/${deck.id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl">{deck.icon}</span>
                  <div className="min-w-0">
                    <h4 className="font-medium text-gray-900 truncate">{deck.name}</h4>
                    <p className="text-xs text-gray-400">{total}장</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {newCards > 0 && (
                    <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">
                      새 {newCards}
                    </span>
                  )}
                  {review > 0 && (
                    <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs">
                      복습 {review}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/decks/${deck.id}/study/setup`)
                    }}
                    className="ml-2 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition cursor-pointer"
                  >
                    학습
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
