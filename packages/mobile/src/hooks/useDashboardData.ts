import { useState, useEffect, useCallback, useRef } from 'react'
import { getMobileSupabase } from '../adapters'
import { useAuthState } from './useAuthState'
import { useDecks } from './useDecks'
import {
  getStreakDays,
  getMasteryRate,
  getDailyStudyCounts,
  getForecastReviews,
  filterLogsByPeriod,
} from '@reeeeecall/shared/lib/stats'
import { periodToDays, shouldShowHeatmap } from '@reeeeecall/shared/lib/time-period'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'

interface DashboardData {
  totalCards: number
  totalDue: number
  streak: number
  mastery: number
  heatmap: { date: string; count: number }[]
  dailyCounts: { date: string; count: number }[]
  forecastData: { date: string; count: number }[]
  loading: boolean
}

export function useDashboardData(period: TimePeriod) {
  const { user } = useAuthState()
  const { decks, stats, loading: decksLoading, refresh: refreshDecks } = useDecks()
  const [data, setData] = useState<DashboardData>({
    totalCards: 0,
    totalDue: 0,
    streak: 0,
    mastery: 0,
    heatmap: [],
    dailyCounts: [],
    forecastData: [],
    loading: true,
  })
  const mountedRef = useRef(true)

  const totalCards = stats.reduce((s, st) => s + (st.total_cards ?? 0), 0)
  const totalDue = stats.reduce(
    (s, st) => s + (st.review_cards ?? 0) + (st.learning_cards ?? 0),
    0,
  )

  const fetchData = useCallback(async () => {
    if (!user?.id) return

    const supabase = getMobileSupabase()
    const days = periodToDays(period)

    const [logsRes, cardsRes] = await Promise.all([
      supabase
        .from('study_logs')
        .select('studied_at')
        .eq('user_id', user.id)
        .order('studied_at', { ascending: false }),
      supabase
        .from('cards')
        .select('srs_status, interval_days, next_review_at')
        .eq('user_id', user.id),
    ])

    if (!mountedRef.current) return

    const allLogs = (logsRes.data ?? []) as { studied_at: string }[]
    const cards = (cardsRes.data ?? []) as { srs_status: string; interval_days: number; next_review_at: string | null }[]
    const filteredLogs = filterLogsByPeriod(allLogs, days)

    setData({
      totalCards,
      totalDue,
      streak: getStreakDays(allLogs),
      mastery: getMasteryRate(cards),
      heatmap: shouldShowHeatmap(period) ? getDailyStudyCounts(filteredLogs, days) : [],
      dailyCounts: getDailyStudyCounts(filteredLogs, Math.min(days, 30)),
      forecastData: getForecastReviews(cards),
      loading: false,
    })
  }, [user?.id, period, totalCards, totalDue])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    return () => { mountedRef.current = false }
  }, [fetchData])

  const refresh = useCallback(async () => {
    await refreshDecks()
    await fetchData()
  }, [refreshDecks, fetchData])

  return { ...data, decks, stats, refresh }
}
