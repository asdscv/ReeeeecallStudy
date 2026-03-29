import { useCallback, useMemo } from 'react'
import { useStudyStore } from '@reeeeecall/shared/stores/study-store'
import type { StudyMode } from '@reeeeecall/shared/types/database'
import type { CrammingFilter } from '@reeeeecall/shared/lib/cramming-queue'
import * as Haptics from 'expo-haptics'

/**
 * Hook for study session — wraps shared study store + mobile-specific features (haptics).
 */
export function useStudy() {
  const store = useStudyStore()

  const startSession = useCallback(async (
    deckId: string,
    mode: StudyMode,
    batchSize = 20,
    uploadDateStart?: string,
    uploadDateEnd?: string,
    crammingFilter?: CrammingFilter,
    crammingTimeLimitMinutes?: number | null,
    crammingShuffle?: boolean,
  ) => {
    await store.initSession({
      deckId,
      mode,
      batchSize,
      uploadDateStart,
      uploadDateEnd,
      crammingFilter,
      crammingTimeLimitMinutes,
      crammingShuffle,
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

  const undoLastRating = useCallback(() => {
    store.undoLastRating()
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  }, [store])

  const reset = useCallback(() => {
    store.reset()
  }, [store])

  const currentCard = useMemo(() => {
    if (store.config?.mode === 'cramming' && store.crammingManager) {
      const cardId = store.crammingManager.currentCardId()
      return cardId ? store.queue.find(c => c.id === cardId) ?? null : null
    }
    return store.queue[store.currentIndex] ?? null
  }, [store.config, store.crammingManager, store.queue, store.currentIndex])
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
    lastRatedCard: store.lastRatedCard,
    // Actions
    startSession,
    flipCard,
    rateCard,
    undoLastRating,
    exitSession,
    reset,
  }
}
