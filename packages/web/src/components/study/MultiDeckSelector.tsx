import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth-store'
import { useDeckStore } from '../../stores/deck-store'

export function MultiDeckSelector() {
  const { t } = useTranslation(['study', 'common'])
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { decks, stats, loading, fetchDecks, fetchStats } = useDeckStore()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchDecks()
    if (user) fetchStats(user.id)
  }, [fetchDecks, fetchStats, user])

  const deckStats = (deckId: string) => stats.find(s => s.deck_id === deckId)

  const toggleDeck = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(decks.map(d => d.id)))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const totalCards = decks
    .filter(d => selectedIds.has(d.id))
    .reduce((sum, d) => sum + (deckStats(d.id)?.total_cards ?? 0), 0)

  const handleStart = () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds).join(',')
    navigate(`/decks/${Array.from(selectedIds)[0]}/study?multiDeck=${ids}&mode=srs`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
        {t('study:multiDeck.title', 'Multi-Deck Study')}
      </h3>

      <div className="flex gap-2 mb-3">
        <button
          onClick={selectAll}
          className="text-xs px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
        >
          {t('common:actions.selectAll')}
        </button>
        <button
          onClick={deselectAll}
          className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {t('common:actions.deselect')}
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
                  ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleDeck(deck.id)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">
                {deck.icon} {deck.name}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {st?.total_cards ?? 0} {t('common:units.cards')}
              </span>
            </label>
          )
        })}
        {decks.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            {t('study:multiDeck.noDecks', 'No decks found.')}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {t('study:multiDeck.selected', '{{count}} decks selected', { count: selectedIds.size })}
          {' / '}
          {totalCards} {t('common:units.cards')}
        </span>
        <button
          onClick={handleStart}
          disabled={selectedIds.size === 0}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {t('study:multiDeck.start', 'Start Multi-Deck Study')}
        </button>
      </div>
    </div>
  )
}
