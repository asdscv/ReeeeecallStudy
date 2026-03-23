import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { AchievementsSummary } from '../components/dashboard/AchievementsSummary'
import { DailyQuestsWidget } from '../components/dashboard/DailyQuestsWidget'
import { StreakFreezeWidget } from '../components/dashboard/StreakFreezeWidget'
import { NextGoalsWidget } from '../components/dashboard/NextGoalsWidget'
import { TimePeriodTabs } from '../components/common/TimePeriodTabs'
import { GuideHelpLink } from '../components/common/GuideHelpLink'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
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

      // Fetch cards (only needed columns) and study logs in parallel
      const [cardsRes, logsRes] = await Promise.all([
        supabase
          .from('cards')
          .select('id, deck_id, srs_status, ease_factor, interval_days, next_review_at')
          .eq('user_id', user.id),
        supabase
          .from('study_logs')
          .select('id, card_id, deck_id, rating, studied_at')
          .eq('user_id', user.id)
          .gte('studied_at', daysAgoUTC(180))
          .order('studied_at', { ascending: false })
          .limit(5000),
      ])

      const cards = cardsRes.data
      const logs = logsRes.data

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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('title')}</h1>
          <GuideHelpLink section="getting-started" />
        </div>
        <TimePeriodTabs value={period} onChange={setPeriod} />
      </div>

      <StatsSummaryCards
        totalCards={totalCards}
        dueToday={dueToday}
        streak={streak}
        masteryRate={masteryRate}
      />

      {/* Achievements + Level */}
      <AchievementsSummary />

      {/* Gamification widgets — 3 column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StreakFreezeWidget />
        <DailyQuestsWidget />
        <NextGoalsWidget />
      </div>

      {shouldShowHeatmap(period) && <StudyHeatmap data={heatmapData} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <ForecastWidget data={forecastData} />
        <DailyStudyChart data={dailyData} />
      </div>

      <RecentDecks decks={decks} stats={stats} />
    </div>
  )
}
