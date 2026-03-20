import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { AdminErrorState } from '../../components/admin/AdminErrorState'

/* ──────────────────────────────── Types ──────────────────────────────── */

type AuditLog = {
  id: string
  admin_id: string
  admin_display_name: string | null
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

/* ──────────────────────────── Constants ───────────────────────────── */

const PAGE_SIZE = 50
const AUTO_REFRESH_INTERVAL = 30_000

const ACTION_TYPES = [
  'all',
  'set_official',
  'resolve_report',
  'set_user_status',
  'update_settings',
  'export_data',
] as const

const TARGET_TYPES = ['all', 'user', 'listing', 'report', 'system'] as const

type ActionType = (typeof ACTION_TYPES)[number]
type TargetType = (typeof TARGET_TYPES)[number]

/* ──────────────────────────── Helpers ─────────────────────────────── */

const ACTION_COLOR_MAP: Record<string, string> = {
  // green — read / view
  view: 'bg-green-100 text-green-800',
  read: 'bg-green-100 text-green-800',
  export_data: 'bg-green-100 text-green-800',
  // blue — create
  create: 'bg-blue-100 text-blue-800',
  set_official: 'bg-blue-100 text-blue-800',
  // yellow — update
  update: 'bg-yellow-100 text-yellow-800',
  update_settings: 'bg-yellow-100 text-yellow-800',
  resolve_report: 'bg-yellow-100 text-yellow-800',
  set_user_status: 'bg-yellow-100 text-yellow-800',
  // red — destructive
  delete: 'bg-red-100 text-red-800',
  ban: 'bg-red-100 text-red-800',
  revoke: 'bg-red-100 text-red-800',
}

function actionBadgeClass(action: string): string {
  return ACTION_COLOR_MAP[action] ?? 'bg-gray-100 text-gray-800'
}

function formatTimestamp(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function toISODate(dateStr: string): string | undefined {
  if (!dateStr) return undefined
  return new Date(dateStr).toISOString()
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/* ──────────────────────────── Component ───────────────────────────── */

export function AdminAuditPage() {
  const { t, i18n } = useTranslation('admin')

  const {
    auditLogs,
    auditLoading,
    auditError,
    fetchAuditLogs,
  } = useAdminStore()

  /* ── Filter state ── */
  const [actionFilter, setActionFilter] = useState<ActionType>('all')
  const [targetFilter, setTargetFilter] = useState<TargetType>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ── Build filters ── */
  const filters = useMemo(
    () => ({
      action: actionFilter === 'all' ? undefined : actionFilter,
      targetType: targetFilter === 'all' ? undefined : targetFilter,
      fromDate: toISODate(dateFrom) ?? undefined,
      toDate: dateTo ? new Date(new Date(dateTo).getTime() + 86_400_000 - 1).toISOString() : undefined,
    }),
    [actionFilter, targetFilter, dateFrom, dateTo],
  )

  /* ── Fetch ── */
  const doFetch = useCallback(() => {
    fetchAuditLogs(page, PAGE_SIZE, filters)
  }, [fetchAuditLogs, page, filters])

  useEffect(() => {
    doFetch()
  }, [doFetch])

  /* ── Auto-refresh ── */
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(doFetch, AUTO_REFRESH_INTERVAL)
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [autoRefresh, doFetch])

  /* ── Search handler (resets page) ── */
  const handleSearch = () => {
    setPage(0)
    // params will change via page reset, triggering useEffect
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  /* ── Export CSV ── */
  const handleExportCSV = () => {
    if (!auditLogs || auditLogs.length === 0) return

    const headers = ['Time', 'Admin', 'Action', 'Target Type', 'Target ID', 'Details', 'IP Address']
    const rows = (auditLogs as AuditLog[]).map((log) => [
      log.created_at,
      log.admin_display_name ?? log.admin_id,
      log.action,
      log.target_type,
      log.target_id ?? '',
      JSON.stringify(log.details),
      log.ip_address ?? '',
    ])

    const csvContent = [
      headers.map(escapeCSVField).join(','),
      ...rows.map((row) => row.map(escapeCSVField).join(',')),
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /* ── Pagination helpers ── */
  const logs = (auditLogs ?? []) as AuditLog[]
  const hasNextPage = logs.length === PAGE_SIZE
  const hasPrevPage = page > 0

  /* ── Toggle expanded row ── */
  const toggleRow = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id))
  }

  /* ── Error state ── */
  if (auditError) {
    return <AdminErrorState error={auditError} onRetry={doFetch} />
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('audit.title', 'Audit Log')}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('audit.description', 'Track all administrative actions across the system')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
            />
            {t('audit.autoRefresh', 'Auto-refresh')}
          </label>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!logs.length}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {t('audit.exportCSV', 'Export CSV')}
          </button>
        </div>
      </div>

      {/* ─── Filter Bar ─── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          {/* Action type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('audit.filterAction', 'Action Type')}
            </label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value as ActionType)
                setPage(0)
              }}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            >
              {ACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'all'
                    ? t('audit.actionAll', 'All Actions')
                    : t(`audit.action.${type}`, type.replace(/_/g, ' '))}
                </option>
              ))}
            </select>
          </div>

          {/* Target type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('audit.filterTarget', 'Target Type')}
            </label>
            <select
              value={targetFilter}
              onChange={(e) => {
                setTargetFilter(e.target.value as TargetType)
                setPage(0)
              }}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            >
              {TARGET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'all'
                    ? t('audit.targetAll', 'All Targets')
                    : t(`audit.target.${type}`, type)}
                </option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('audit.dateFrom', 'From')}
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Date to */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('audit.dateTo', 'To')}
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Search button */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSearch}
              disabled={auditLoading}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {auditLoading ? t('audit.searching', 'Searching...') : t('audit.search', 'Search')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActionFilter('all')
                setTargetFilter('all')
                setDateFrom('')
                setDateTo('')
                setPage(0)
              }}
              className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              {t('audit.reset', 'Reset')}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Loading skeleton */}
        {auditLoading && logs.length === 0 ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          /* Empty state */
          <div className="p-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">
              {t('audit.emptyTitle', 'No audit logs found')}
            </h3>
            <p className="text-xs text-gray-500">
              {t('audit.emptyDescription', 'There are no logs matching your current filters. Try adjusting your search criteria.')}
            </p>
          </div>
        ) : (
          <>
            {/* Inline loading indicator */}
            {auditLoading && (
              <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
                <p className="text-xs text-indigo-600 animate-pulse">
                  {t('audit.refreshing', 'Refreshing...')}
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colTime', 'Time')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colAdmin', 'Admin')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colAction', 'Action')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colTarget', 'Target')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colDetails', 'Details')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {t('audit.colIP', 'IP')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      locale={i18n.language}
                      expanded={expandedRow === log.id}
                      onToggle={() => toggleRow(log.id)}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ─── Pagination ─── */}
      {(hasPrevPage || hasNextPage) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {t('audit.pageInfo', 'Page {{page}}', { page: page + 1 })}
            {logs.length > 0 && (
              <span className="ml-1">
                ({t('audit.showing', 'showing {{count}} entries', { count: logs.length })})
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!hasPrevPage}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {t('audit.prevPage', 'Previous')}
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {t('audit.nextPage', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────── Log Row ─────────────────────────────── */

interface LogRowProps {
  log: AuditLog
  locale: string
  expanded: boolean
  onToggle: () => void
  t: ReturnType<typeof import('react-i18next').useTranslation>['t']
}

function LogRow({ log, locale, expanded, onToggle, t }: LogRowProps) {
  const detailKeys = Object.keys(log.details)
  const hasDetails = detailKeys.length > 0
  const previewText = hasDetails
    ? detailKeys.slice(0, 2).join(', ') + (detailKeys.length > 2 ? '...' : '')
    : '-'

  return (
    <>
      <tr
        className={`hover:bg-gray-50 transition-colors ${hasDetails ? 'cursor-pointer' : ''} ${
          expanded ? 'bg-indigo-50/40' : ''
        }`}
        onClick={hasDetails ? onToggle : undefined}
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onKeyDown={
          hasDetails
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle()
                }
              }
            : undefined
        }
      >
        {/* Time */}
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
          {formatTimestamp(log.created_at, locale)}
        </td>

        {/* Admin */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-sm text-gray-900 font-medium">
            {log.admin_display_name ?? t('audit.unknownAdmin', 'Unknown')}
          </span>
          <p className="text-xs text-gray-400 font-mono truncate max-w-[120px]" title={log.admin_id}>
            {log.admin_id.slice(0, 8)}
          </p>
        </td>

        {/* Action badge */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionBadgeClass(log.action)}`}
          >
            {t(`audit.action.${log.action}`, log.action.replace(/_/g, ' '))}
          </span>
        </td>

        {/* Target */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-xs text-gray-500 uppercase tracking-wide">
            {t(`audit.target.${log.target_type}`, log.target_type)}
          </span>
          {log.target_id && (
            <p className="text-xs text-gray-400 font-mono truncate max-w-[120px]" title={log.target_id}>
              {log.target_id.slice(0, 8)}
            </p>
          )}
        </td>

        {/* Details preview */}
        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
          <span className="flex items-center gap-1">
            {hasDetails && (
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${
                  expanded ? 'rotate-90' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
            {previewText}
          </span>
        </td>

        {/* IP */}
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400 font-mono">
          {log.ip_address ?? '-'}
        </td>
      </tr>

      {/* Expanded details row */}
      {expanded && hasDetails && (
        <tr className="bg-gray-50/80">
          <td colSpan={6} className="px-6 py-4">
            <div className="text-xs">
              <p className="text-gray-500 font-medium mb-2">
                {t('audit.fullDetails', 'Full Details')}
              </p>
              <pre className="bg-gray-900 text-green-300 rounded-lg p-4 overflow-x-auto text-xs leading-relaxed max-h-64 overflow-y-auto">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
