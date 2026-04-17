import { useEffect, useCallback } from 'react'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useAuthState } from './useAuthState'

/**
 * Hook for deck data — wraps shared deck store for mobile.
 *
 * Staleness 정책:
 *   - 마운트 시 fetchDecks()/fetchStats()/fetchTemplates() 호출하지만
 *     store 내부에서 5분 이내 데이터는 스킵 (STALE_AFTER_MS).
 *   - Pull-to-refresh 시 force: true로 강제 갱신.
 *   - Prefetch service가 스플래시 때 이미 로드했으면 여기서 네트워크 안 탐.
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

  // 마운트 시 데이터 확인 (store가 fresh면 네트워크 스킵)
  useEffect(() => {
    fetchDecks()
    fetchTemplates()
    if (user?.id) fetchStats(user.id)
  }, [fetchDecks, fetchStats, fetchTemplates, user?.id])

  // Pull-to-refresh용 — 강제 갱신
  const refresh = useCallback(async () => {
    await fetchDecks({ force: true })
    if (user?.id) await fetchStats(user.id, { force: true })
    await fetchTemplates({ force: true })
  }, [fetchDecks, fetchStats, fetchTemplates, user?.id])

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
