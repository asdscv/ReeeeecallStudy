import { useCallback, useMemo } from 'react'
import { useStudyStore, type PlanSelection } from '@reeeeecall/shared/stores/study-store'
import type { StudyMode } from '@reeeeecall/shared/types/database'
import type { CrammingFilter } from '@reeeeecall/shared/lib/cramming-queue'
import { calculateStudyProgress } from '@reeeeecall/shared/lib/study-progress'
import { haptics } from '../utils/haptics'

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

  /**
   * Start one deck's share of a daily plan.
   *
   * Always `srs`: the other five modes send no SRS payload and reschedule nothing
   * (`modeFeedsSrsSchedule`), so completing plan items from one of them would mark the day done
   * while leaving every input the planner reads untouched — and `apply_plan_study_rating`
   * refuses anything but the four SRS ratings anyway.
   *
   * The batch size is the plan's own count, not the learner's default: the planner already
   * decided how much today is, including its new-card cap.
   */
  const startPlanSession = useCallback(async (deckId: string, planSelection: PlanSelection) => {
    await store.initSession({
      deckId,
      mode: 'srs',
      batchSize: planSelection.cardIds.length,
      planSelection,
      // Derived, not passed: the selection already knows its goal, and mobile's plan session used
      // to end at StudySetup — the top of the deck stack — exactly like an ordinary deck session.
      fromGoalId: planSelection.goalId,
    })
  }, [store])

  /**
   * Study exactly these cards — the diagnostics panel's "다시 볼 카드" button.
   *
   * Always SRS: a card the learner keeps failing has to have its schedule moved, and the
   * cramming modes move nothing (`modeFeedsSrsSchedule`). No plan item is completed, because
   * these cards were not on today's plan — that is why the ordinary queue never serves them.
   */
  const startCardSession = useCallback(async (deckId: string, cardIds: string[], fromGoalId?: string) => {
    await store.initSession({
      deckId,
      mode: 'srs',
      batchSize: cardIds.length,
      cardSelection: cardIds,
      // Carried so the summary can offer 플랜으로 돌아가기 instead of dropping the learner at
      // the top of the deck stack. See `SessionConfig.fromGoalId`.
      fromGoalId,
    })
  }, [store])

  const flipCard = useCallback(() => {
    store.flipCard()
    haptics.tap()
  }, [store])

  const rateCard = useCallback(async (rating: string) => {
    // Distinct feedback by outcome — a failed recall should not feel like a win.
    if (rating === 'again' || rating === 'missed' || rating === 'unknown') {
      haptics.error()
    } else if (rating === 'hard') {
      haptics.warning()
    } else {
      haptics.success()
    }
    await store.rateCard(rating)
  }, [store])

  const exitSession = useCallback(async () => {
    await store.exitSession()
  }, [store])

  const crammingTimeUp = useCallback(async () => {
    await store.crammingTimeUp()
  }, [store])

  const undoLastRating = useCallback(async () => {
    if (store.undoState === 'pending') return
    haptics.warning()
    // Awaits the server compensation: the local rollback only happens if the DB
    // accepts it, so callers must not assume the state changed on return.
    await store.undoLastRating()
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
  const progress = calculateStudyProgress(
    store.config?.mode ?? 'random',
    store.sessionStats.cardsStudied,
    store.sessionStats.totalCards,
    store.crammingManager?.masteryPercentage(),
  )

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
    undoState: store.undoState,
    subscriptionLocked: store.subscriptionLocked,
    crammingManager: store.crammingManager,
    // Actions
    startSession,
    startPlanSession,
    startCardSession,
    flipCard,
    rateCard,
    undoLastRating,
    exitSession,
    crammingTimeUp,
    reset,
  }
}
