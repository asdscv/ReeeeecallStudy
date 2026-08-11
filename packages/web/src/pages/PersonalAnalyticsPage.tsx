import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'
import { resolveRange, type DateRange, type TimePeriod } from '../lib/time-period'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

interface RetentionPoint { interval: string; retention: number }
interface WeakTopic { name: string; errorRate: number }
interface TimeDistribution { hour: string; minutes: number }
interface ModeEffectiveness { mode: string; retention: number }
interface ProgressPoint { week: string; mastered: number }

interface AnalyticsProps {
  /**
   * The window the BEHAVIOUR charts cover. Omitted means all time.
   *
   * Only three of the five charts can honour it. Weak topics, time-of-day and mode
   * effectiveness are counts of things that happened, so a window is meaningful. The
   * retention curve and the progress line read the learner's CURRENT card state — there is
   * no such thing as "my retention during July", only "my retention now" — so they stay
   * all-time and say so on screen rather than silently ignoring the control.
   */
  period?: TimePeriod
  range?: DateRange | null
}

/** Standalone analytics content — can be used as a tab inside StudyHistoryPage */
export function PersonalAnalyticsContent({ period, range }: AnalyticsProps = {}) {
  const { t } = useTranslation('common')
  const { user } = useAuthStore()
  const window = period ? resolveRange(period, range ?? null) : null
  const fromIso = window ? new Date(window.fromMs).toISOString() : null
  const toIso = window ? new Date(window.toMs).toISOString() : null

  const [retentionData, setRetentionData] = useState<RetentionPoint[]>([])
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([])
  const [timeDistribution, setTimeDistribution] = useState<TimeDistribution[]>([])
  const [modeEffectiveness, setModeEffectiveness] = useState<ModeEffectiveness[]>([])
  const [progressData, setProgressData] = useState<ProgressPoint[]>([])
  const [loading, setLoading] = useState(true)


  async function loadRetentionCurve(userId: string) {
    // `learner_card_schedule` (mig 184), NOT `cards`.
    //
    // A learner's SRS state lives in `cards` only for decks they OWN. For a subscribed deck
    // the cards belong to the publisher and the learner's schedule is in
    // `user_card_progress` — 14,805 rows across 7 accounts in production. Reading
    // `cards WHERE user_id = me` therefore returned nothing at all for a subscriber, and
    // this chart drew a flat 0% retention curve that looked like a finding rather than a
    // missing join.
    const { data } = await supabase.rpc('learner_card_schedule', {
      p_user_id: userId,
      p_deck_ids: null,
    })
    // The RPC is untyped here, so name its shape once rather than at each use.
    const cards = (data ?? []) as Array<{
      srs_status: string | null
      interval_days: number | null
      last_reviewed_at: string | null
    }>
    if (!cards.length) return
    const intervals = [
      { label: '1d', min: 0, max: 1 },
      { label: '3d', min: 2, max: 3 },
      { label: '7d', min: 4, max: 7 },
      { label: '14d', min: 8, max: 14 },
      { label: '30d', min: 15, max: 30 },
      { label: '60d+', min: 31, max: Infinity },
    ]
    const result: RetentionPoint[] = intervals.map(({ label, min, max }) => {
      const bucket = cards.filter((c) =>
        (c.interval_days ?? -1) >= min && (c.interval_days ?? -1) <= max && c.last_reviewed_at)
      const retained = bucket.filter((c) => c.srs_status === 'review')
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
      .gte('studied_at', fromIso ?? '1970-01-01T00:00:00.000Z')
      .lte('studied_at', toIso ?? '2999-01-01T00:00:00.000Z')
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
      .gte('started_at', fromIso ?? '1970-01-01T00:00:00.000Z')
      .lte('started_at', toIso ?? '2999-01-01T00:00:00.000Z')
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
      .gte('studied_at', fromIso ?? '1970-01-01T00:00:00.000Z')
      .lte('studied_at', toIso ?? '2999-01-01T00:00:00.000Z')
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

  // Declared after the loaders on purpose: the React Compiler rejects reading a
  // function before its declaration, and hoisting made the effect fire against
  // identifiers it could not verify.
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
  }, [user, fromIso, toIso])

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
      </div>
    )
  }

  const sectionClass = 'bg-card rounded-xl border border-border p-4 sm:p-6'

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">
        {t('analytics.title')}
      </h1>

      {/* Retention Curve */}
      <div className={sectionClass}>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t('analytics.retentionCurve')}</h2>
          {/* Said out loud: this chart reads current card state, so a period control cannot
              apply to it. Silently ignoring the selection is what makes a dashboard feel
              broken. */}
          <span className="text-xs text-content-tertiary">{t('analytics.allTime')}</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={retentionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="interval" />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v) => [t('analytics.percent', { value: Number(v) }), t('analytics.retentionLabel')]} />
              <Line type="monotone" dataKey="retention" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two-column layout for smaller charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weak Topics */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t('analytics.weakTopics')}
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weakTopics} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [t('analytics.percent', { value: Number(v) }), t('analytics.errorRateLabel')]} />
                <Bar dataKey="errorRate" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mode Effectiveness */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-foreground mb-4">
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
                <Tooltip formatter={(v) => [t('analytics.percent', { value: Number(v) }), t('analytics.retentionLabel')]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Study Time Distribution */}
      <div className={sectionClass}>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {t('analytics.studyTime')}
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}m`} />
              <Tooltip formatter={(v) => [t('analytics.minutes', { count: Number(v) }), t('analytics.studyTimeLabel')]} />
              <Bar dataKey="minutes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Progress Over Time */}
      <div className={sectionClass}>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t('analytics.progress')}</h2>
          {/* Cumulative by construction — a window would make the line start mid-air. */}
          <span className="text-xs text-content-tertiary">{t('analytics.allTime')}</span>
        </div>
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

/** Page-level export — redirects to /history since analytics is now a tab there */
export function PersonalAnalyticsPage() {
  return <Navigate to="/history" replace />
}
