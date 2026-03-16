import { useEffect, useCallback } from 'react'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'

/**
 * Hook for card data — wraps shared card store for mobile.
 */
export function useCards(deckId: string) {
  const {
    cards,
    loading,
    error,
    fetchCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCards,
  } = useCardStore()

  const refresh = useCallback(() => {
    return fetchCards(deckId)
  }, [fetchCards, deckId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    cards,
    loading,
    error,
    refresh,
    createCard,
    updateCard,
    deleteCard,
    deleteCards,
  }
}
