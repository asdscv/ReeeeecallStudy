import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { computeConversionRate, shareModeLabel } from '../../lib/admin-stats'

export function AdminContentPage() {
  const { t } = useTranslation('admin')
  const { marketStats, marketLoading, marketError, fetchMarket } = useAdminStore()

  useEffect(() => {
    fetchMarket()
  }, [fetchMarket])

  if (marketLoading && !marketStats) {
    return <p className="text-sm text-gray-400 py-8 text-center">{t('loading')}</p>
  }

  if (marketError) {
    return <AdminErrorState error={marketError} onRetry={fetchMarket} />
  }

  const stats = marketStats

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <AdminStatCard icon="📦" label={t('market.totalListings')} value={stats?.total_listings ?? 0} color="blue" />
        <AdminStatCard icon="✅" label={t('market.activeListings')} value={stats?.active_listings ?? 0} color="green" />
        <AdminStatCard icon="📥" label={t('market.totalAcquires')} value={stats?.total_acquires ?? 0} color="purple" />
        <AdminStatCard icon="🔗" label={t('market.totalShares')} value={stats?.total_shares ?? 0} color="orange" />
        <AdminStatCard icon="🤝" label={t('market.activeShares')} value={stats?.active_shares ?? 0} color="pink" />
      </div>

      {/* Conversion KPIs */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <AdminStatCard
            icon="📈"
            label={t('market.acquireConversion')}
            value={`${computeConversionRate(stats.total_acquires, stats.total_listings)}%`}
            color="blue"
          />
          <AdminStatCard
            icon="🔄"
            label={t('market.shareActivation')}
            value={`${computeConversionRate(stats.active_shares, stats.total_shares)}%`}
            color="green"
          />
        </div>
      )}

      {/* Share by mode */}
      {stats?.share_by_mode && stats.share_by_mode.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('market.shareByMode')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {stats.share_by_mode.map((s) => (
              <div key={s.mode} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">{t(shareModeLabel(s.mode), s.mode)}</span>
                <span className="text-sm font-semibold text-gray-900">{s.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top categories */}
      {stats?.top_categories && stats.top_categories.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('market.topCategories')}</h3>
          <div className="space-y-2">
            {stats.top_categories.map((c) => (
              <div key={c.category} className="flex items-center justify-between p-2">
                <span className="text-sm text-gray-700">{c.category}</span>
                <span className="text-sm font-medium text-gray-500">{c.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
