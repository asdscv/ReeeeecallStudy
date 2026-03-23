import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useAdminStore } from '../../stores/admin-store'
import { OfficialBadge } from '../../components/common/OfficialBadge'
import { UserGrowthChart } from '../../components/admin/UserGrowthChart'
import { SignupsChart } from '../../components/admin/SignupsChart'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { computeUserGrowthSeries, computeActiveInactiveUsers, formatStatNumber, userRoleLabel } from '../../lib/admin-stats'
import { formatLocalDate } from '../../lib/date-utils'
import { exportToCsv, EXPORT_CONFIGS } from '../../lib/csv-export'

const PAGE_SIZE = 20

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success',
  suspended: 'bg-warning/15 text-warning',
  banned: 'bg-destructive/15 text-destructive',
}

export function AdminUsersPage() {
  const { t, i18n } = useTranslation('admin')
  const {
    userSignups, userList, userListTotal, retentionMetrics,
    usersLoading, usersError, fetchUsers,
    activeUsers, fetchOverview, setOfficialStatus, setUserStatus,
  } = useAdminStore()
  const [page, setPage] = useState(0)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [officialFilter, setOfficialFilter] = useState<string>('')
  const dateLocale = toIntlLocale(i18n.language)
  const growthData = useMemo(() => computeUserGrowthSeries(userSignups), [userSignups])
  const activeInactive = useMemo(() => activeUsers ? computeActiveInactiveUsers(activeUsers) : [], [activeUsers])

  const filters = useMemo(() => ({
    search: search || undefined,
    role: roleFilter || undefined,
    official: officialFilter === '' ? undefined : officialFilter === 'true',
  }), [search, roleFilter, officialFilter])

  useEffect(() => {
    fetchUsers(page, PAGE_SIZE, filters)
    fetchOverview()
  }, [fetchUsers, fetchOverview, page, filters])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  if (usersError) {
    return <AdminErrorState error={usersError} onRetry={() => fetchUsers(page, PAGE_SIZE)} />
  }

  return (
    <div className="space-y-6">
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {usersLoading && userSignups.length === 0 ? (
          <>
            <div className="h-48 bg-accent rounded-xl animate-pulse" />
            <div className="h-48 bg-accent rounded-xl animate-pulse" />
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
        <div className="bg-card rounded-xl border border-border p-3 sm:p-5">
          <h3 className="text-sm font-medium text-foreground mb-3">{t('users.activeVsInactive')}</h3>
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
          <h2 className="text-sm font-semibold text-foreground mb-3">{t('users.retention')}</h2>
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
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">{t('users.userList')}</h3>
              <button
                type="button"
                onClick={() => exportToCsv(EXPORT_CONFIGS.users.filename, userList, EXPORT_CONFIGS.users.columns)}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded cursor-pointer"
              >
                {t('common.exportCsv')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder={t('users.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg bg-muted focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand w-40 sm:w-48"
              />
              <select
                value={roleFilter}
                onChange={(e) => { setRoleFilter(e.target.value); setPage(0) }}
                className="px-2 py-1.5 text-xs border border-border rounded-lg bg-muted cursor-pointer"
              >
                <option value="">{t('users.allRoles')}</option>
                <option value="admin">{t('users.roles.admin')}</option>
                <option value="user">{t('users.roles.user')}</option>
              </select>
              <select
                value={officialFilter}
                onChange={(e) => { setOfficialFilter(e.target.value); setPage(0) }}
                className="px-2 py-1.5 text-xs border border-border rounded-lg bg-muted cursor-pointer"
              >
                <option value="">{t('users.allStatus')}</option>
                <option value="true">{t('users.officialStatus.on')}</option>
                <option value="false">{t('users.officialStatus.off')}</option>
              </select>
              {(search || roleFilter || officialFilter) && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearch(''); setRoleFilter(''); setOfficialFilter(''); setPage(0) }}
                  className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {t('users.clearFilters')}
                </button>
              )}
            </div>
          </div>
        </div>
        {usersLoading ? (
          <p className="text-sm text-content-tertiary py-8 text-center">{t('loading')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('users.displayName')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('users.role')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('users.official')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('users.setStatus', 'Status')}</th>
                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('users.joinedAt')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {userList.map((u) => (
                    <tr key={u.id} className="hover:bg-muted">
                      <td className="px-4 py-2 text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {u.display_name || t('users.noName')}
                          {u.is_official && <OfficialBadge />}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          u.role === 'admin' ? 'bg-destructive/15 text-destructive' : 'bg-accent text-muted-foreground'
                        }`}>
                          {t(userRoleLabel(u.role), u.role)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          data-testid={`official-toggle-${u.id}`}
                          aria-label={`${t('users.setOfficial')}: ${u.display_name || u.id}`}
                          disabled={togglingId === u.id}
                          onClick={async () => {
                            setTogglingId(u.id)
                            await setOfficialStatus(u.id, !u.is_official)
                            setTogglingId(null)
                          }}
                          className={`text-xs px-2 py-0.5 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-default ${
                            u.is_official
                              ? 'bg-brand/15 text-brand'
                              : 'bg-accent text-muted-foreground'
                          }`}
                        >
                          {togglingId === u.id ? '...' : u.is_official ? t('users.officialStatus.on') : t('users.officialStatus.off')}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={u.user_status || 'active'}
                          disabled={statusChangingId === u.id}
                          onChange={async (e) => {
                            const newStatus = e.target.value as 'active' | 'suspended' | 'banned'
                            if (newStatus === 'banned' && !confirm(t('users.confirmBan', 'Ban this user?'))) return
                            if (newStatus === 'suspended' && !confirm(t('users.confirmSuspend', 'Suspend this user?'))) return
                            setStatusChangingId(u.id)
                            await setUserStatus(u.id, newStatus)
                            setStatusChangingId(null)
                          }}
                          className={`text-xs px-2 py-0.5 rounded-full cursor-pointer disabled:opacity-50 border-0 ${STATUS_STYLES[u.user_status || 'active'] ?? STATUS_STYLES.active}`}
                        >
                          <option value="active">{t('users.status.active', 'Active')}</option>
                          <option value="suspended">{t('users.status.suspended', 'Suspended')}</option>
                          <option value="banned">{t('users.status.banned', 'Banned')}</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{formatLocalDate(u.created_at, dateLocale)}</td>
                    </tr>
                  ))}
                  {userList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-content-tertiary">{t('noData')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {userListTotal > 0 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>{(page * PAGE_SIZE) + 1}~{Math.min((page + 1) * PAGE_SIZE, userListTotal)} / {userListTotal.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={t('users.prevPage')}
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 rounded border border-border disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    &laquo;
                  </button>
                  <button
                    type="button"
                    aria-label={t('users.nextPage')}
                    onClick={() => setPage(page + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= userListTotal}
                    className="px-3 py-1 rounded border border-border disabled:opacity-40 cursor-pointer disabled:cursor-default"
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
