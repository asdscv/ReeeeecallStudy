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

function daysAgoUTC(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString()
}

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

  const fetchData = useCallback(() => {
    if (!user?.id) return

    const supabase = getMobileSupabase()
    const days = periodToDays(period)

    // Use Promise.resolve().then() pattern — proven to work in RN with Supabase
    const logsPromise = Promise.resolve(
      supabase
        .from('study_logs')
        .select('studied_at')
        .eq('user_id', user.id)
        .gte('studied_at', daysAgoUTC(180))
        .order('studied_at', { ascending: false })
        .limit(5000),
    )

    const cardsPromise = Promise.resolve(
      supabase
        .from('cards')
        .select('srs_status, interval_days, next_review_at')
        .eq('user_id', user.id),
    )

    Promise.all([logsPromise, cardsPromise])
      .then(([logsRes, cardsRes]) => {
        if (!mountedRef.current) return

        if (logsRes.error) {
          console.warn('[useDashboardData] study_logs error:', logsRes.error.message)
        }
        if (cardsRes.error) {
          console.warn('[useDashboardData] cards error:', cardsRes.error.message)
        }

        const allLogs = (logsRes.data ?? []) as { studied_at: string }[]
        const cards = (cardsRes.data ?? []) as {
          srs_status: string
          interval_days: number
          next_review_at: string | null
        }[]

        const filteredLogs = filterLogsByPeriod(allLogs, days)
        console.log('[dashboard] logs:', allLogs.length, 'filtered:', filteredLogs.length)

        // Check if today's logs exist directly
        const today = new Date().toISOString().slice(0, 10)
        const todayLogs = allLogs.filter(l => l.studied_at.startsWith(today))
        console.log('[dashboard] today(' + today + '):', todayLogs.length, 'logs')
        if (allLogs.length > 0) {
          console.log('[dashboard] newest:', allLogs[0].studied_at.slice(0, 19))
        }

        setData({
          totalCards,
          totalDue,
          streak: getStreakDays(allLogs),
          mastery: getMasteryRate(cards),
          heatmap: shouldShowHeatmap(period) ? getDailyStudyCounts(allLogs, 180) : [],
          dailyCounts: getDailyStudyCounts(filteredLogs, days),
          forecastData: getForecastReviews(cards),
          loading: false,
        })
      })
      .catch((err) => {
        console.warn('[useDashboardData] fetch error:', err)
        if (mountedRef.current) {
          setData((prev) => ({ ...prev, loading: false }))
        }
      })
  }, [user?.id, period, totalCards, totalDue])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    return () => {
      mountedRef.current = false
    }
  }, [fetchData])

  const refresh = useCallback(async () => {
    await refreshDecks()
    fetchData()
  }, [refreshDecks, fetchData])

  return { ...data, decks, stats, refresh }
}
