import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { supabase } from '../lib/supabase'
import {
  getForecastReviews,
  getHeatmapData,
  getDailyStudyCounts,
  getStreakDays,
  getMasteryRate,
} from '../lib/stats'
import type { Card, StudyLog } from '../types/database'
import { StatsSummaryCards } from '../components/dashboard/StatsSummaryCards'
import { StudyHeatmap } from '../components/dashboard/StudyHeatmap'
import { ForecastWidget } from '../components/dashboard/ForecastWidget'
import { DailyStudyChart } from '../components/dashboard/DailyStudyChart'
import { RecentDecks } from '../components/dashboard/RecentDecks'

export function DashboardPage() {
  const { user } = useAuthStore()
  const { decks, stats, loading, fetchDecks, fetchStats } = useDeckStore()

  const [allCards, setAllCards] = useState<Card[]>([])
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [dataLoading, setDataLoading] = useState(true)

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
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      const { data: logs } = await supabase
        .from('study_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('studied_at', oneYearAgo.toISOString())
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

  // Compute dashboard stats
  const totalCards = stats.reduce((sum, s) => sum + s.total_cards, 0)
  const dueToday = stats.reduce((sum, s) => sum + s.review_cards + s.learning_cards, 0)
  const streak = getStreakDays(studyLogs)
  const masteryRate = getMasteryRate(allCards)

  const heatmapData = getHeatmapData(studyLogs)
  const forecastData = getForecastReviews(allCards)
  const dailyData = getDailyStudyCounts(studyLogs)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>

      <StatsSummaryCards
        totalCards={totalCards}
        dueToday={dueToday}
        streak={streak}
        masteryRate={masteryRate}
      />

      <StudyHeatmap data={heatmapData} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ForecastWidget data={forecastData} />
        <DailyStudyChart data={dailyData} />
      </div>

      <RecentDecks decks={decks} stats={stats} />
    </div>
  )
}
