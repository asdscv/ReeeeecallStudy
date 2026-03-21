import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

interface RetentionPoint { interval: string; retention: number }
interface WeakTopic { name: string; errorRate: number }
interface TimeDistribution { hour: string; minutes: number }
interface ModeEffectiveness { mode: string; retention: number }
interface ProgressPoint { week: string; mastered: number }

export function PersonalAnalyticsPage() {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()

  const [retentionData, setRetentionData] = useState<RetentionPoint[]>([])
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([])
  const [timeDistribution, setTimeDistribution] = useState<TimeDistribution[]>([])
  const [modeEffectiveness, setModeEffectiveness] = useState<ModeEffectiveness[]>([])
  const [progressData, setProgressData] = useState<ProgressPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const load = async () => {
      setLoading(true)
      await Promise.all([
        loadRetentionCurve(user.id),
        loadWeakTopics(user.id),
        loadTimeDistribution(user.id),
        loadModeEffectiveness(user.id),
        loadProgress(user.id),
      ])
      setLoading(false)
    }
    load()
  }, [user])

  async function loadRetentionCurve(userId: string) {
    const { data: cards } = await supabase
      .from('cards')
      .select('srs_status, interval_days, last_reviewed_at')
      .eq('user_id', userId)
    if (!cards) return
    const intervals = [
      { label: '1d', min: 0, max: 1 },
      { label: '3d', min: 2, max: 3 },
      { label: '7d', min: 4, max: 7 },
      { label: '14d', min: 8, max: 14 },
      { label: '30d', min: 15, max: 30 },
      { label: '60d+', min: 31, max: Infinity },
    ]
    const result: RetentionPoint[] = intervals.map(({ label, min, max }) => {
      const bucket = cards.filter(c => c.interval_days >= min && c.interval_days <= max && c.last_reviewed_at)
      const retained = bucket.filter(c => c.srs_status === 'review')
      const rate = bucket.length > 0 ? Math.round((retained.length / bucket.length) * 100) : 0
      return { interval: label, retention: rate }
    })
    setRetentionData(result)
  }

  async function loadWeakTopics(userId: string) {
    const { data: logs } = await supabase
      .from('study_logs')
      .select('deck_id, rating')
      .eq('user_id', userId)
      .order('studied_at', { ascending: false })
      .limit(2000)
    if (!logs || logs.length === 0) return

    const { data: decks } = await supabase
      .from('decks')
      .select('id, name')
      .eq('user_id', userId)

    const deckMap = new Map((decks ?? []).map(d => [d.id, d.name]))
    const deckErrors: Record<string, { total: number; wrong: number }> = {}

    for (const log of logs) {
      if (!deckErrors[log.deck_id]) deckErrors[log.deck_id] = { total: 0, wrong: 0 }
      deckErrors[log.deck_id].total++
      if (log.rating === 'again' || log.rating === 'hard') {
        deckErrors[log.deck_id].wrong++
      }
    }

    const result: WeakTopic[] = Object.entries(deckErrors)
      .map(([deckId, { total, wrong }]) => ({
        name: deckMap.get(deckId) ?? deckId.slice(0, 8),
        errorRate: Math.round((wrong / total) * 100),
      }))
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 8)

    setWeakTopics(result)
  }

  async function loadTimeDistribution(userId: string) {
    const { data: sessions } = await supabase
      .from('study_sessions')
      .select('started_at, total_duration_ms')
      .eq('user_id', userId)
    if (!sessions) return

    const hourMap: Record<number, number> = {}
    for (let h = 0; h < 24; h++) hourMap[h] = 0

    for (const s of sessions) {
      const hour = new Date(s.started_at).getHours()
      hourMap[hour] += Math.round(s.total_duration_ms / 60000)
    }

    setTimeDistribution(
      Object.entries(hourMap).map(([h, minutes]) => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        minutes,
      }))
    )
  }

  async function loadModeEffectiveness(userId: string) {
    const { data: logs } = await supabase
      .from('study_logs')
      .select('study_mode, rating')
      .eq('user_id', userId)
      .limit(5000)
    if (!logs || logs.length === 0) return

    const modeStats: Record<string, { total: number; good: number }> = {}
    for (const log of logs) {
      if (!modeStats[log.study_mode]) modeStats[log.study_mode] = { total: 0, good: 0 }
      modeStats[log.study_mode].total++
      if (log.rating === 'good' || log.rating === 'easy') {
        modeStats[log.study_mode].good++
      }
    }

    setModeEffectiveness(
      Object.entries(modeStats).map(([mode, { total, good }]) => ({
        mode,
        retention: Math.round((good / total) * 100),
      }))
    )
  }

  async function loadProgress(userId: string) {
    const { data: cards } = await supabase
      .from('cards')
      .select('srs_status, last_reviewed_at')
      .eq('user_id', userId)
      .eq('srs_status', 'review')
      .not('last_reviewed_at', 'is', null)
    if (!cards) return

    const weekMap: Record<string, number> = {}
    for (const c of cards) {
      if (!c.last_reviewed_at) continue
      const d = new Date(c.last_reviewed_at)
      // ISO week start
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const weekStart = new Date(d.setDate(diff))
      const key = weekStart.toISOString().slice(0, 10)
      weekMap[key] = (weekMap[key] ?? 0) + 1
    }

    const sorted = Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b))
    let cumulative = 0
    setProgressData(
      sorted.map(([week, count]) => {
        cumulative += count
        return { week, mastered: cumulative }
      })
    )
  }

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const sectionClass = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6'

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
        {t('analytics.title')}
      </h1>

      {/* Retention Curve */}
      <div className={sectionClass}>
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
          {t('analytics.retentionCurve')}
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={retentionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="interval" />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v) => [`${v}%`, 'Retention']} />
              <Line type="monotone" dataKey="retention" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two-column layout for smaller charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weak Topics */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
            {t('analytics.weakTopics')}
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weakTopics} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`${v}%`, 'Error Rate']} />
                <Bar dataKey="errorRate" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mode Effectiveness */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
            {t('analytics.modeEffectiveness')}
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={modeEffectiveness}
                  dataKey="retention"
                  nameKey="mode"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, value }) => `${name}: ${value}%`}
                >
                  {modeEffectiveness.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v}%`, 'Retention']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Study Time Distribution */}
      <div className={sectionClass}>
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
          {t('analytics.studyTime')}
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}m`} />
              <Tooltip formatter={(v) => [`${v} min`, 'Study Time']} />
              <Bar dataKey="minutes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Progress Over Time */}
      <div className={sectionClass}>
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">
          {t('analytics.progress')}
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={progressData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="mastered" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
