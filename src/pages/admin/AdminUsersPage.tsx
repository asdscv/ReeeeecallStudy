import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useAdminStore } from '../../stores/admin-store'
import { UserGrowthChart } from '../../components/admin/UserGrowthChart'
import { SignupsChart } from '../../components/admin/SignupsChart'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { computeUserGrowthSeries, computeActiveInactiveUsers, formatStatNumber, userRoleLabel } from '../../lib/admin-stats'
import { formatLocalDate } from '../../lib/date-utils'

const PAGE_SIZE = 20

export function AdminUsersPage() {
  const { t, i18n } = useTranslation('admin')
  const {
    userSignups, userList, userListTotal, retentionMetrics,
    usersLoading, usersError, fetchUsers,
    activeUsers, fetchOverview,
  } = useAdminStore()
  const [page, setPage] = useState(0)
  const dateLocale = toIntlLocale(i18n.language)
  const growthData = useMemo(() => computeUserGrowthSeries(userSignups), [userSignups])
  const activeInactive = useMemo(() => activeUsers ? computeActiveInactiveUsers(activeUsers) : [], [activeUsers])

  useEffect(() => {
    fetchUsers(page, PAGE_SIZE)
    fetchOverview()
  }, [fetchUsers, fetchOverview, page])

  if (usersError) {
    return <AdminErrorState error={usersError} onRetry={() => fetchUsers(page, PAGE_SIZE)} />
  }

  return (
    <div className="space-y-6">
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {usersLoading && userSignups.length === 0 ? (
          <>
            <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
            <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
          </>
        ) : (
          <>
            <UserGrowthChart data={growthData} />
            <SignupsChart data={userSignups} />
          </>
        )}
      </div>

      {/* Active vs Inactive pie */}
      {activeInactive.length > 0 && activeInactive.some(s => s.value > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t('users.activeVsInactive')}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={activeInactive}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, value }) => `${name === 'active' ? t('users.active') : t('users.inactive')}: ${value.toLocaleString()}`}
              >
                <Cell fill="#3b82f6" />
                <Cell fill="#d1d5db" />
              </Pie>
              <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === 'active' ? t('users.active') : t('users.inactive')]} />
              <Legend formatter={(value: string) => value === 'active' ? t('users.active') : t('users.inactive')} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Retention Metrics */}
      {retentionMetrics && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('users.retention')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <AdminStatCard icon="📊" label={t('users.prevMonthActive')} value={formatStatNumber(retentionMetrics.prev_month_active)} color="blue" />
            <AdminStatCard icon="✅" label={t('users.retained')} value={formatStatNumber(retentionMetrics.retained)} color="green" />
            <AdminStatCard icon="🎯" label={t('users.retentionRate')} value={`${retentionMetrics.retention_rate}%`} color="green" />
            <AdminStatCard icon="📉" label={t('users.churned')} value={formatStatNumber(retentionMetrics.churned)} color="orange" />
            <AdminStatCard icon="⚠️" label={t('users.churnRate')} value={`${retentionMetrics.churn_rate}%`} color="orange" />
            <AdminStatCard icon="🆕" label={t('users.newUsersThisMonth')} value={formatStatNumber(retentionMetrics.new_users_this_month)} color="purple" />
          </div>
        </div>
      )}

      {/* User list table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">{t('users.userList')}</h3>
        </div>
        {usersLoading ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t('loading')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('users.displayName')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('users.role')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('users.joinedAt')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {userList.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{u.display_name || t('users.noName')}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {t(userRoleLabel(u.role), u.role)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{formatLocalDate(u.created_at, dateLocale)}</td>
                    </tr>
                  ))}
                  {userList.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-400">{t('noData')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {userListTotal > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>{(page * PAGE_SIZE) + 1}~{Math.min((page + 1) * PAGE_SIZE, userListTotal)} / {userListTotal.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={t('users.prevPage')}
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    &laquo;
                  </button>
                  <button
                    type="button"
                    aria-label={t('users.nextPage')}
                    onClick={() => setPage(page + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= userListTotal}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    &raquo;
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
