import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'
import { useDeckStore } from '../../stores/deck-store'

export function MultiDeckSelector() {
  const { t } = useTranslation(['study', 'common'])
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { decks, stats, fetchDecks, fetchStats } = useDeckStore()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchDecks()
    if (user) fetchStats(user.id)
  }, [fetchDecks, fetchStats, user])

  const deckStats = (deckId: string) => stats.find(s => s.deck_id === deckId)

  const toggleDeck = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(decks.map(d => d.id)))
  const deselectAll = () => setSelectedIds(new Set())

  const totalCards = decks
    .filter(d => selectedIds.has(d.id))
    .reduce((sum, d) => sum + (deckStats(d.id)?.total_cards ?? 0), 0)

  const handleStart = () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds).join(',')
    navigate(`/decks/${Array.from(selectedIds)[0]}/study?multiDeck=${ids}&mode=srs`)
  }

  return (
    <div className="bg-card rounded-xl border border-border mb-4">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
      >
        <span className="text-sm font-medium text-foreground">
          {t('study:multiDeck.title')}
          {selectedIds.size > 0 && (
            <span className="ml-2 text-xs text-brand dark:text-brand/70">
              ({selectedIds.size}{t('common:units.decksCount', '개')})
            </span>
          )}
        </span>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-content-tertiary" />
          : <ChevronDown className="w-4 h-4 text-content-tertiary" />
        }
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-4 pb-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={selectAll}
              className="text-xs px-2 py-1 bg-brand/10 dark:bg-blue-900/30 text-brand dark:text-brand/70 rounded-md hover:bg-brand/15 transition-colors cursor-pointer"
            >
              {t('study:multiDeck.selectAll')}
            </button>
            <button
              onClick={deselectAll}
              className="text-xs px-2 py-1 bg-accent text-muted-foreground rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              {t('study:multiDeck.deselectAll')}
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 mb-4">
            {decks.map(deck => {
              const st = deckStats(deck.id)
              const checked = selectedIds.has(deck.id)
              return (
                <label
                  key={deck.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    checked
                      ? 'bg-brand/10 dark:bg-blue-900/20 border border-brand/30 dark:border-blue-800'
                      : 'hover:bg-muted/50 border border-transparent'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDeck(deck.id)}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                  <span className="flex-1 text-sm text-foreground truncate">
                    {deck.icon} {deck.name}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {st?.total_cards ?? 0}{t('study:multiDeck.cards', { count: st?.total_cards ?? 0 })}
                  </span>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0
                ? `${selectedIds.size}${t('study:multiDeck.decksUnit', '개 덱')} / ${totalCards}${t('study:multiDeck.cardsUnit', '장')}`
                : t('study:multiDeck.selectHint', 'Select decks to study together')
              }
            </span>
            <button
              onClick={handleStart}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {t('study:multiDeck.start')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
