import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'
import { resolveRange, type DateRange, type TimePeriod } from '../lib/time-period'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

interface RetentionPoint { interval: string; retention: number; cards: number }
interface WeakTopic { name: string; errorRate: number }
interface TimeDistribution { hour: string; minutes: number }
interface ModeEffectiveness { mode: string; retention: number }
interface ProgressPoint { week: string; mastered: number }

/**
 * A chart with nothing to draw should say so in words.
 *
 * recharts renders an empty series as a dashed grid and a set of axis ticks, which is exactly
 * what a chart looks like when its query failed — and on this page several of them genuinely
 * had failed, silently, for months. Keeping the box and filling it with a sentence means an
 * empty chart can no longer be mistaken for a broken one.
 */
function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="h-64 flex items-center justify-center">
      <p className="text-sm text-muted-foreground text-center px-4">{message}</p>
    </div>
  )
}

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
  // 'study' as well as 'common': the mode labels live there, and a namespace that is not
  // declared resolves to the raw key at first paint.
  const { t } = useTranslation(['common', 'study'])
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


  // No `userId` parameter: `my_card_schedule` derives it from `auth.uid()`, which is the
  // whole point of the wrapper.
  async function loadRetentionCurve() {
    // AGGREGATED SERVER-SIDE. `my_card_schedule` returns one row per card across the whole
    // library, and this page called it twice at once — PostgREST cancelled both with "canceling
    // statement due to statement timeout", which the page swallowed into an empty chart exactly
    // the way the earlier permission error had. Six numbers do not need thousands of rows: the
    // RPC does the bucketing, and it went from 7.6s to 1.0s in the doing.
    const { data, error } = await supabase.rpc('my_retention_curve')
    if (error) {
      console.error('[analytics] retention curve:', error.message)
      return
    }
    const rows = (data ?? []) as Array<{ interval_label: string; retention: number; cards: number }>
    if (!rows.length) return
    setRetentionData(rows.map((r) => ({ interval: r.interval_label, retention: r.retention, cards: r.cards })))
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
        // The learner's word for it, not the column value. The history tab on this same page
        // already translates `study_mode`; the chart printed the raw enum, so the legend read
        // "srs".
        modeLabel: t(`study:modes.${mode}.label`, { defaultValue: mode }),
        retention: Math.round((good / total) * 100),
      }))
    )
  }

  async function loadProgress() {
    // Also aggregated server-side, and for the same two reasons: it pulled the whole library to
    // count weeks, and it read `cards WHERE user_id = me` — which returns nothing for a
    // SUBSCRIBER, so this chart was empty for exactly the learners who study most from shared
    // decks. The RPC applies the same deck-level membership rule the rest of the app does.
    const { data, error } = await supabase.rpc('my_review_progress', { p_weeks: 26 })
    if (error) {
      console.error('[analytics] progress over time:', error.message)
      return
    }
    const rows = (data ?? []) as Array<{ week: string; total: number }>
    setProgressData(rows.map((r) => ({ week: r.week, mastered: r.total })))
  }

  // Declared after the loaders on purpose: the React Compiler rejects reading a
  // function before its declaration, and hoisting made the effect fire against
  // identifiers it could not verify.
  useEffect(() => {
    if (!user) return
    const load = async () => {
      setLoading(true)
      await Promise.all([
        loadRetentionCurve(),
        loadWeakTopics(user.id),
        loadTimeDistribution(user.id),
        loadModeEffectiveness(user.id),
        loadProgress(),
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
        {/* The RPC always returns all six buckets, so a learner with nothing in review gets a
            flat line along zero — indistinguishable from the empty box this chart drew for
            months while its query was failing. Count the cards, not the percentages. */}
        {retentionData.every(p => p.cards === 0) ? (
          <ChartEmpty message={t('analytics.emptyRetention')} />
        ) : (
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
        )}
      </div>

      {/* Two-column layout for smaller charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weak Topics */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t('analytics.weakTopics')}
          </h2>
          {/* No decks, or every deck at a 0% error rate. A learner who has rated everything good
              or easy has nothing weak, and recharts draws that as a dashed grid with a deck name
              floating beside an invisible bar — pixel-for-pixel a broken chart. "Nothing is weak"
              and "this failed to load" should not look the same. */}
          {weakTopics.every(w => w.errorRate === 0) ? (
            <ChartEmpty message={t('analytics.emptyWeakTopics')} />
          ) : (
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
          )}
        </div>

        {/* Mode Effectiveness */}
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t('analytics.modeEffectiveness')}
          </h2>
          {modeEffectiveness.length === 0 ? (
            <ChartEmpty message={t('analytics.emptyModes')} />
          ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              {/* BARS, not a pie.
                  `retention` is a per-mode percentage — each one is 0-100 on its own — and a pie
                  divides values by their sum, so three modes at 90/80/70% drew slices of 38/33/29%,
                  numbers that mean nothing. With a single mode studied it drew one slice of 100%:
                  the solid blue disc that filled the card. A bar per mode against a 0-100 axis is
                  the same data saying something true, and it degrades gracefully to one bar. */}
              <BarChart data={modeEffectiveness} layout="vertical"
                margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="modeLabel" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [t('analytics.percent', { value: Number(v) }), t('analytics.retentionLabel')]} />
                <Bar dataKey="retention" radius={[0, 4, 4, 0]}>
                  {modeEffectiveness.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </div>
      </div>

      {/* Study Time Distribution */}
      <div className={sectionClass}>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {t('analytics.studyTime')}
        </h2>
        {timeDistribution.every(d => d.minutes === 0) ? (
          <ChartEmpty message={t('analytics.emptyStudyTime')} />
        ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              {/* Whole minutes only. A single one-minute session drew ticks at 0.25m / 0.5m /
                  0.75m, which is a granularity the data does not have — study time is summed
                  from session durations and never means a quarter of a minute. */}
              <YAxis tickFormatter={(v) => `${Math.round(Number(v))}m`} allowDecimals={false} />
              <Tooltip formatter={(v) => [t('analytics.minutes', { count: Number(v) }), t('analytics.studyTimeLabel')]} />
              <Bar dataKey="minutes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </div>

      {/* Progress Over Time */}
      <div className={sectionClass}>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t('analytics.progress')}</h2>
          {/* Cumulative by construction — a window would make the line start mid-air. */}
          <span className="text-xs text-content-tertiary">{t('analytics.allTime')}</span>
        </div>
        {progressData.length === 0 ? (
          <ChartEmpty message={t('analytics.emptyProgress')} />
        ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={progressData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              {/* Dots on a short series. A line between two points needs two points: an account
                  with one week of history drew a curve of zero length and `dot={false}` meant
                  there was nothing else to see — a chart with data in it that looked exactly as
                  empty as the ones whose queries were failing. Dots are noise on a long series,
                  so they are only turned on where the line cannot carry the shape itself. */}
              <Line type="monotone" dataKey="mastered" stroke="#10b981" strokeWidth={2}
                dot={progressData.length < 8} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        )}
      </div>
    </div>
  )
}

/** Page-level export — redirects to /history since analytics is now a tab there */
export function PersonalAnalyticsPage() {
  return <Navigate to="/history" replace />
}
