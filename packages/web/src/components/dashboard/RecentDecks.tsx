import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  if (decks.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <div className="text-5xl mb-4">📚</div>
        <p className="text-muted-foreground mb-4">{t('recentDecks.noDecks')}</p>
        <button
          onClick={() => navigate('/decks')}
          className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition cursor-pointer"
        >
          {t('recentDecks.goToDecks')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-3">{t('recentDecks.title')}</h3>
      <div className="grid gap-3">
        {decks.map((deck) => {
          const deckStat = stats.find((s) => s.deck_id === deck.id)
          const total = deckStat?.total_cards ?? 0
          const newCards = deckStat?.new_cards ?? 0
          const review = (deckStat?.review_cards ?? 0) + (deckStat?.learning_cards ?? 0)

          return (
            <div
              key={deck.id}
              className="bg-card rounded-xl border border-border p-3 sm:p-4 hover:shadow-sm transition cursor-pointer"
              onClick={() => navigate(`/decks/${deck.id}`)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl">{deck.icon}</span>
                  <div className="min-w-0">
                    <h4 className="font-medium text-foreground truncate">{deck.name}</h4>
                    <p className="text-xs text-content-tertiary">{t('recentDecks.cardCount', { count: total })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 pl-9 sm:pl-0">
                  {newCards > 0 && (
                    <span className="px-2.5 py-0.5 bg-brand/10 text-brand rounded-full text-xs">
                      {t('recentDecks.newCards', { count: newCards })}
                    </span>
                  )}
                  {review > 0 && (
                    <span className="px-2.5 py-0.5 bg-warning/10 text-warning rounded-full text-xs">
                      {t('recentDecks.reviewCards', { count: review })}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/decks/${deck.id}/study/setup`)
                    }}
                    className="ml-auto sm:ml-2 px-3 py-1 bg-brand text-white rounded-lg text-xs font-medium hover:bg-brand transition cursor-pointer"
                  >
                    {t('recentDecks.study')}
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
