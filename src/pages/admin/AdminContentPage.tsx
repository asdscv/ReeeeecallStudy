import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useAdminStore } from '../../stores/admin-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { computeConversionRate, shareModeLabel } from '../../lib/admin-stats'

const SHARE_MODE_COLORS: Record<string, string> = {
  copy: '#3b82f6',
  subscribe: '#10b981',
  snapshot: '#f59e0b',
}

export function AdminContentPage() {
  const { t } = useTranslation('admin')
  const { marketStats, marketLoading, marketError, fetchMarket } = useAdminStore()

  useEffect(() => {
    fetchMarket()
  }, [fetchMarket])

  const shareModePieData = useMemo(() => {
    if (!marketStats?.share_by_mode) return []
    return marketStats.share_by_mode.map((s) => ({
      ...s,
      name: t(shareModeLabel(s.mode), s.mode),
    }))
  }, [marketStats, t])

  const categoryBarData = useMemo(() => {
    if (!marketStats?.top_categories) return []
    return marketStats.top_categories.slice(0, 10)
  }, [marketStats])

  if (marketLoading && !marketStats) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (marketError) {
    return <AdminErrorState error={marketError} onRetry={fetchMarket} />
  }

  const stats = marketStats

  const acquireRate = stats ? computeConversionRate(stats.total_acquires, stats.total_listings) : 0
  const shareActivation = stats ? computeConversionRate(stats.active_shares, stats.total_shares) : 0
  const listingActiveRate = stats ? computeConversionRate(stats.active_listings, stats.total_listings) : 0

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <AdminStatCard icon="📦" label={t('market.totalListings')} value={stats?.total_listings ?? 0} color="blue" subtitle={t('market.activeRate', { value: listingActiveRate })} />
        <AdminStatCard icon="✅" label={t('market.activeListings')} value={stats?.active_listings ?? 0} color="green" />
        <AdminStatCard icon="📥" label={t('market.totalAcquires')} value={stats?.total_acquires ?? 0} color="purple" />
        <AdminStatCard icon="🔗" label={t('market.totalShares')} value={stats?.total_shares ?? 0} color="orange" />
        <AdminStatCard icon="🤝" label={t('market.activeShares')} value={stats?.active_shares ?? 0} color="pink" />
      </div>

      {/* Conversion KPIs */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <AdminStatCard
            icon="📈"
            label={t('market.acquireConversion')}
            value={`${acquireRate}%`}
            color="blue"
            size="lg"
            subtitle={`${stats.total_acquires} / ${stats.total_listings}`}
          />
          <AdminStatCard
            icon="🔄"
            label={t('market.shareActivation')}
            value={`${shareActivation}%`}
            color="green"
            size="lg"
            subtitle={`${stats.active_shares} / ${stats.total_shares}`}
          />
          <AdminStatCard
            icon="📊"
            label={t('market.avgAcquiresPerListing')}
            value={stats.active_listings > 0 ? (stats.total_acquires / stats.active_listings).toFixed(1) : '0'}
            color="purple"
            size="lg"
          />
        </div>
      )}

      {/* Share by mode - Pie Chart + List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shareModePieData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t('market.shareByMode')}</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={shareModePieData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={40}
                  label={(props) => `${props.name ?? ''} (${((props.percent ?? 0) * 100).toFixed(0)}%)`}
                >
                  {shareModePieData.map((item) => (
                    <Cell key={item.mode} fill={SHARE_MODE_COLORS[item.mode] ?? '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [Number(value).toLocaleString()]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Share mode stats cards */}
        {stats?.share_by_mode && stats.share_by_mode.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t('market.shareBreakdown')}</h3>
            <div className="space-y-3">
              {stats.share_by_mode.map((s) => {
                const total = stats.share_by_mode!.reduce((acc, m) => acc + m.count, 0)
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
                return (
                  <div key={s.mode} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{t(shareModeLabel(s.mode), s.mode)}</span>
                      <span className="text-sm font-semibold text-gray-900">{s.count.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: SHARE_MODE_COLORS[s.mode] ?? '#6b7280' }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">{pct}%</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top categories - Horizontal Bar Chart */}
      {categoryBarData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('market.topCategories')}</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, categoryBarData.length * 36)}>
            <BarChart data={categoryBarData} layout="vertical" margin={{ left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={(value) => [Number(value).toLocaleString(), t('market.listings')]} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
