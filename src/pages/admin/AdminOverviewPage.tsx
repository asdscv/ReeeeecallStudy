import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { RecentActivityChart } from '../../components/admin/RecentActivityChart'
import { computeEngagementMetrics, formatTotalStudyTime, formatStatNumber, computeWeekOverWeekFromDaily } from '../../lib/admin-stats'
import type { TrendChange } from '../../lib/admin-stats'

function TrendBadge({ trend }: { trend: TrendChange }) {
  if (trend.direction === 'flat') return <span className="text-xs text-gray-400">-</span>
  const color = trend.direction === 'up' ? 'text-green-600' : 'text-red-500'
  const arrow = trend.direction === 'up' ? '\u2191' : '\u2193'
  return <span className={`text-xs font-medium ${color}`}>{arrow} {Math.abs(trend.change)}%</span>
}

export function AdminOverviewPage() {
  const { t } = useTranslation('admin')
  const {
    overviewStats, activeUsers, recentActivity,
    overviewLoading, overviewError, fetchOverview,
  } = useAdminStore()

  const engagement = useMemo(() => activeUsers ? computeEngagementMetrics(activeUsers) : null, [activeUsers])
  const wow = useMemo(() => computeWeekOverWeekFromDaily(recentActivity), [recentActivity])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  if (overviewLoading && !overviewStats) {
    return <p className="text-sm text-gray-400 py-8 text-center">{t('loading')}</p>
  }

  if (overviewError) {
    return <AdminErrorState error={overviewError} onRetry={fetchOverview} />
  }

  const stats = overviewStats

  return (
    <div className="space-y-6">
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

      {/* WoW Trend Indicators */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">{t('overview.weekOverWeek')}</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">{t('study.sessions')}</p>
            <TrendBadge trend={wow.sessions} />
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">{t('overview.activeUsers')}</p>
            <TrendBadge trend={wow.activeUsers} />
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">{t('study.cards')}</p>
            <TrendBadge trend={wow.cards} />
          </div>
        </div>
      </div>

      {/* Recent activity chart */}
      <RecentActivityChart data={recentActivity} />

      {/* Engagement */}
      {activeUsers && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('overview.engagement')}</h2>
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
