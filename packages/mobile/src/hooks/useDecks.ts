import { useEffect, useCallback } from 'react'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useAuthState } from './useAuthState'

/**
 * Hook for deck data — wraps shared deck store for mobile.
 */
export function useDecks() {
  const { user } = useAuthState()
  const {
    decks,
    stats,
    templates,
    loading,
    error,
    fetchDecks,
    fetchStats,
    fetchTemplates,
    createDeck,
    updateDeck,
    deleteDeck,
  } = useDeckStore()

  const refresh = useCallback(async () => {
    await fetchDecks()
    if (user?.id) await fetchStats(user.id)
  }, [fetchDecks, fetchStats, user?.id])

  useEffect(() => {
    refresh()
    fetchTemplates()
  }, [refresh, fetchTemplates])

  const getStatsForDeck = useCallback((deckId: string) => {
    return stats.find((s) => s.deck_id === deckId)
  }, [stats])

  return {
    decks,
    stats,
    templates,
    loading,
    error,
    refresh,
    getStatsForDeck,
    createDeck,
    updateDeck,
    deleteDeck,
  }
}
