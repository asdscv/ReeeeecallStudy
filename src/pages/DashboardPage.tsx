import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { supabase } from '../lib/supabase'
import { daysAgoUTC } from '../lib/date-utils'
import {
  getForecastReviews,
  getHeatmapData,
  getDailyStudyCounts,
  getStreakDays,
  getMasteryRate,
  filterLogsByPeriod,
} from '../lib/stats'
import { periodToDays, shouldShowHeatmap } from '../lib/time-period'
import type { TimePeriod } from '../lib/time-period'
import type { Card, StudyLog } from '../types/database'
import { StatsSummaryCards } from '../components/dashboard/StatsSummaryCards'
import { StudyHeatmap } from '../components/dashboard/StudyHeatmap'
import { ForecastWidget } from '../components/dashboard/ForecastWidget'
import { DailyStudyChart } from '../components/dashboard/DailyStudyChart'
import { RecentDecks } from '../components/dashboard/RecentDecks'
import { TimePeriodTabs } from '../components/common/TimePeriodTabs'

export function DashboardPage() {
  const { user } = useAuthStore()
  const { decks, stats, loading, fetchDecks, fetchStats } = useDeckStore()

  const [allCards, setAllCards] = useState<Card[]>([])
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [period, setPeriod] = useState<TimePeriod>('1m')

  useEffect(() => {
    fetchDecks()
    if (user) fetchStats(user.id)
  }, [user, fetchDecks, fetchStats])

  // Fetch all cards + study logs for the current user
  useEffect(() => {
    if (!user) return
    let cancelled = false

    const fetchDashboardData = async () => {
      setDataLoading(true)

      // Fetch all user cards
      const { data: cards } = await supabase
        .from('cards')
        .select('*')
        .eq('user_id', user.id)

      // Fetch study logs from last year
      const { data: logs } = await supabase
        .from('study_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('studied_at', daysAgoUTC(365))
        .order('studied_at', { ascending: false })

      if (!cancelled) {
        setAllCards((cards ?? []) as Card[])
        setStudyLogs((logs ?? []) as StudyLog[])
        setDataLoading(false)
      }
    }

    fetchDashboardData()
    return () => { cancelled = true }
  }, [user])

  if (loading || dataLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📊</div>
      </div>
    )
  }

  // Compute dashboard stats (streak & mastery use full data)
  const totalCards = stats.reduce((sum, s) => sum + s.total_cards, 0)
  const dueToday = stats.reduce((sum, s) => sum + s.review_cards + s.learning_cards, 0)
  const streak = getStreakDays(studyLogs)
  const masteryRate = getMasteryRate(allCards)

  // Filter logs by selected period for charts
  const days = periodToDays(period)
  const filteredLogs = filterLogsByPeriod(studyLogs, days)

  const heatmapData = getHeatmapData(filteredLogs)
  const forecastData = getForecastReviews(allCards)
  const dailyData = getDailyStudyCounts(filteredLogs, days)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <TimePeriodTabs value={period} onChange={setPeriod} />
      </div>

      <StatsSummaryCards
        totalCards={totalCards}
        dueToday={dueToday}
        streak={streak}
        masteryRate={masteryRate}
      />

      {shouldShowHeatmap(period) && <StudyHeatmap data={heatmapData} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ForecastWidget data={forecastData} />
        <DailyStudyChart data={dailyData} />
      </div>

      <RecentDecks decks={decks} stats={stats} />
    </div>
  )
}
