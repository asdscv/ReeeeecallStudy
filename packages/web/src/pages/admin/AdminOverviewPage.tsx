import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { RecentActivityChart } from '../../components/admin/RecentActivityChart'
import { computeEngagementMetrics, formatTotalStudyTime, formatStatNumber, computeWeekOverWeekFromDaily } from '../../lib/admin-stats'
import type { TrendChange } from '../../lib/admin-stats'

function TrendBadge({ trend, label }: { trend: TrendChange; label?: string }) {
  if (trend.direction === 'flat') return <span className="text-xs text-content-tertiary">-</span>
  const color = trend.direction === 'up' ? 'text-success' : 'text-destructive'
  const arrow = trend.direction === 'up' ? '\u2191' : '\u2193'
  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(trend.change)}%
      {label && <span className="text-content-tertiary font-normal ml-1">{label}</span>}
    </span>
  )
}

function HealthScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 50 50)" className="transition-all duration-700"
        />
        <text x="50" y="50" textAnchor="middle" dy="6" className="text-lg font-bold" fill={color} fontSize="20">
          {score}
        </text>
      </svg>
    </div>
  )
}

export function AdminOverviewPage() {
  const { t } = useTranslation('admin')
  const {
    overviewStats, activeUsers, recentActivity,
    overviewLoading, overviewError, fetchOverview,
  } = useAdminStore()

  const engagement = useMemo(() => activeUsers ? computeEngagementMetrics(activeUsers) : null, [activeUsers])
  const wow = useMemo(() => computeWeekOverWeekFromDaily(recentActivity), [recentActivity])

  // Compute health score based on engagement metrics and trends
  const healthScore = useMemo(() => {
    let score = 50 // base
    if (engagement) {
      if (engagement.dauMauRatio >= 20) score += 15
      else if (engagement.dauMauRatio >= 10) score += 8
      if (engagement.adoptionRate >= 30) score += 15
      else if (engagement.adoptionRate >= 15) score += 8
    }
    if (wow.sessions.direction === 'up') score += 10
    else if (wow.sessions.direction === 'down') score -= 10
    if (wow.activeUsers.direction === 'up') score += 10
    else if (wow.activeUsers.direction === 'down') score -= 10
    return Math.max(0, Math.min(100, score))
  }, [engagement, wow])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  if (overviewLoading && !overviewStats) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-accent rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (overviewError) {
    return <AdminErrorState error={overviewError} onRetry={fetchOverview} />
  }

  const stats = overviewStats

  return (
    <div className="space-y-6">
      {/* Health Score + Key Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
        <div className="bg-card rounded-xl border border-border p-4 flex flex-col items-center justify-center">
          <HealthScoreRing score={healthScore} />
          <p className="text-xs text-muted-foreground mt-1">{t('overview.healthScore')}</p>
        </div>

        {/* WoW Trend Indicators */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">{t('overview.weekOverWeek')}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">{t('study.sessions')}</p>
              <TrendBadge trend={wow.sessions} />
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">{t('overview.activeUsers')}</p>
              <TrendBadge trend={wow.activeUsers} />
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">{t('study.cards')}</p>
              <TrendBadge trend={wow.cards} />
            </div>
          </div>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <AdminStatCard icon="👥" label={t('overview.totalUsers')} value={stats?.total_users ?? 0} color="blue" />
        <AdminStatCard icon="📚" label={t('overview.totalDecks')} value={stats?.total_decks ?? 0} color="green" />
        <AdminStatCard icon="🃏" label={t('overview.totalCards')} value={stats?.total_cards ?? 0} color="purple" />
        <AdminStatCard icon="📝" label={t('overview.totalSessions')} value={stats?.total_sessions ?? 0} color="orange" />
        <AdminStatCard icon="⏱️" label={t('overview.totalStudyTime')} value={formatTotalStudyTime(stats?.total_study_time_ms ?? 0)} color="pink" />
      </div>

      {/* Secondary metrics + KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <AdminStatCard icon="🎓" label={t('overview.totalCardsStudied')} value={stats?.total_cards_studied ?? 0} color="blue" />
        <AdminStatCard icon="📋" label={t('overview.totalTemplates')} value={stats?.total_templates ?? 0} color="gray" />
        <AdminStatCard icon="🔗" label={t('overview.totalSharedDecks')} value={stats?.total_shared_decks ?? 0} color="green" />
        <AdminStatCard icon="🏪" label={t('overview.totalListings')} value={stats?.total_marketplace_listings ?? 0} color="purple" />
        <AdminStatCard
          icon="⏳"
          label={t('overview.avgSessionDuration')}
          value={stats && stats.total_sessions > 0
            ? formatTotalStudyTime(Math.round(stats.total_study_time_ms / stats.total_sessions))
            : '-'}
          color="orange"
        />
        <AdminStatCard
          icon="📇"
          label={t('overview.avgCardsPerSession')}
          value={stats && stats.total_sessions > 0
            ? formatStatNumber(Math.round(stats.total_cards_studied / stats.total_sessions))
            : '-'}
          color="pink"
        />
      </div>

      {/* Recent activity chart */}
      <RecentActivityChart data={recentActivity} />

      {/* Engagement */}
      {activeUsers && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">{t('overview.engagement')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <AdminStatCard icon="📊" label={t('overview.dau')} value={activeUsers.dau} color="blue" />
            <AdminStatCard icon="📈" label={t('overview.wau')} value={activeUsers.wau} color="green" />
            <AdminStatCard icon="📅" label={t('overview.mau')} value={activeUsers.mau} color="purple" />
            {engagement && (
              <>
                <AdminStatCard icon="🎯" label={t('overview.dauMauRatio')} value={`${engagement.dauMauRatio}%`} color="orange" />
                <AdminStatCard icon="🔥" label={t('overview.wauMauRatio')} value={`${engagement.wauMauRatio}%`} color="pink" />
                <AdminStatCard icon="🚀" label={t('overview.adoptionRate')} value={`${engagement.adoptionRate}%`} color="gray" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
