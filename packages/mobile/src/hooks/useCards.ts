import { useCallback } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'

/**
 * Hook for card data — wraps shared card store for mobile.
 *
 * Fetches on screen focus (not just mount): the card-store TTL-caches each
 * deck's list, so returning to a deck is instant when fresh and refetches when
 * a card/study mutation invalidated it. `refresh` (pull-to-refresh) forces.
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
    return fetchCards(deckId, { force: true })
  }, [fetchCards, deckId])

  useFocusEffect(
    useCallback(() => {
      void fetchCards(deckId)
    }, [fetchCards, deckId]),
  )

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
