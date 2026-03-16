import { useCallback } from 'react'
import { useStudyStore } from '@reeeeecall/shared/stores/study-store'
import type { StudyMode } from '@reeeeecall/shared/types/database'
import * as Haptics from 'expo-haptics'

/**
 * Hook for study session — wraps shared study store + mobile-specific features (haptics).
 */
export function useStudy() {
  const store = useStudyStore()

  const startSession = useCallback(async (deckId: string, mode: StudyMode, batchSize = 20) => {
    await store.initSession({
      deckId,
      mode,
      batchSize,
    })
  }, [store])

  const flipCard = useCallback(() => {
    store.flipCard()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }, [store])

  const rateCard = useCallback(async (rating: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    await store.rateCard(rating)
  }, [store])

  const exitSession = useCallback(async () => {
    await store.exitSession()
  }, [store])

  const reset = useCallback(() => {
    store.reset()
  }, [store])

  const currentCard = store.queue[store.currentIndex] ?? null
  const progress = store.queue.length > 0
    ? Math.round((store.sessionStats.cardsStudied / store.sessionStats.totalCards) * 100)
    : 0

  return {
    // State
    phase: store.phase,
    currentCard,
    isFlipped: store.isFlipped,
    isRating: store.isRating,
    exitDirection: store.exitDirection,
    config: store.config,
    template: store.template,
    sessionStats: store.sessionStats,
    progress,
    queue: store.queue,
    currentIndex: store.currentIndex,
    // Actions
    startSession,
    flipCard,
    rateCard,
    exitSession,
    reset,
  }
}
