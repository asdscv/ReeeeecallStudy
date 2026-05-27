import { useCallback } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useAuthState } from './useAuthState'

/**
 * Hook for deck data — wraps shared deck store for mobile.
 *
 * Staleness 정책:
 *   - 화면 포커스 시 fetchDecks()/fetchStats()/fetchTemplates() 호출하지만
 *     store 내부 TTL 캐시(5분, createStaleCache)로 그 이내 데이터는 스킵.
 *   - 덱/카드 mutation이 store 캐시를 무효화하므로, 다른 화면에서 수정 후
 *     목록으로 돌아오면 (focus) 최신 데이터로 갱신된다. (마운트 전용
 *     useEffect였을 때는 이미 마운트된 목록이 재요청하지 않아 stale 했음.)
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

  // 화면 포커스 시 데이터 확인 (store가 fresh면 네트워크 스킵)
  useFocusEffect(
    useCallback(() => {
      fetchDecks()
      fetchTemplates()
      if (user?.id) fetchStats(user.id)
    }, [fetchDecks, fetchStats, fetchTemplates, user?.id]),
  )

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
