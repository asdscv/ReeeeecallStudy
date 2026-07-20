import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { microWonToWon } from '@reeeeecall/shared/lib/ai/server-client'
import { useAdminStore } from '../../stores/admin-store'
import type { AdminSubscriptionRow, AdminPaymentRow } from '../../stores/admin-store'
import { useBillingStore } from '../../stores/billing-store'
import { confirm } from '../../stores/confirm-store'
import { AdminStatCard } from '../../components/admin/AdminStatCard'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { toIntlLocale } from '../../lib/locale-utils'
import { formatLocalDate, formatLocalDateTime } from '../../lib/date-utils'

const PAGE_SIZE = 50

const SUB_STATUSES = ['active', 'canceled', 'grace', 'past_due', 'expired', 'refunded'] as const

const SUB_STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success',
  canceled: 'bg-warning/15 text-warning',
  grace: 'bg-warning/15 text-warning',
  past_due: 'bg-destructive/15 text-destructive',
  expired: 'bg-accent text-muted-foreground',
  refunded: 'bg-destructive/15 text-destructive',
}

const PAY_STATUS_STYLES: Record<string, string> = {
  paid: 'bg-success/15 text-success',
  pending: 'bg-warning/15 text-warning',
  failed: 'bg-destructive/15 text-destructive',
  refunded: 'bg-destructive/15 text-destructive',
  canceled: 'bg-accent text-muted-foreground',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function AdminBillingPage() {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = toIntlLocale(i18n.language)
  const {
    billingOverview, billingSubscriptions, billingPayments,
    billingOverviewLoading, billingSubsLoading, billingPaymentsLoading,
    billingError,
    fetchBillingOverview, fetchBillingSubscriptions, fetchBillingPayments,
    cancelSubscription, refundPayment, forceRefresh,
  } = useAdminStore()

  const [statusFilter, setStatusFilter] = useState('')
  const [subsPage, setSubsPage] = useState(0)
  const [payPage, setPayPage] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const fmtMicro = (micro: number) => `₩${microWonToWon(micro).toLocaleString(dateLocale)}`
  const fmtKrw = (won: number) => `₩${(won ?? 0).toLocaleString(dateLocale)}`

  useEffect(() => { fetchBillingOverview() }, [fetchBillingOverview])
  useEffect(() => { fetchBillingSubscriptions(statusFilter || undefined, subsPage, PAGE_SIZE) }, [fetchBillingSubscriptions, statusFilter, subsPage])
  useEffect(() => { fetchBillingPayments(payPage, PAGE_SIZE) }, [fetchBillingPayments, payPage])

  const refreshAll = () => {
    forceRefresh('billing')
    fetchBillingOverview()
    fetchBillingSubscriptions(statusFilter || undefined, subsPage, PAGE_SIZE)
    fetchBillingPayments(payPage, PAGE_SIZE)
  }

  const doCancel = async (row: AdminSubscriptionRow, immediate: boolean) => {
    if (!row.provider || !row.provider_subscription_id) {
      setActionError(t('billing.subscriptions.noProviderSub'))
      return
    }
    const who = row.email || row.user_id
    const ok = await confirm({
      title: immediate ? t('billing.subscriptions.confirmImmediateTitle') : t('billing.subscriptions.confirmPeriodEndTitle'),
      message: `${immediate
        ? t('billing.subscriptions.confirmImmediate', { email: who })
        : t('billing.subscriptions.confirmPeriodEnd', { email: who })}\n\n${t('billing.subscriptions.refundNote')}`,
      danger: immediate,
    })
    if (!ok) return
    setActionError(null)
    setBusyId(row.id)
    const { error } = await cancelSubscription(row.provider, row.provider_subscription_id, immediate)
    setBusyId(null)
    if (error) {
      setActionError(t('billing.actionError', { error }))
    } else {
      fetchBillingSubscriptions(statusFilter || undefined, subsPage, PAGE_SIZE)
      fetchBillingOverview()
    }
  }

  const doRefundCreditPack = async (row: AdminPaymentRow) => {
    const ok = await confirm({
      title: t('billing.refund.confirmTitle'),
      message: `${t('billing.refund.confirmCreditPack', { amount: fmtKrw(row.amount_krw), email: row.email || row.user_id })}\n\n${t('billing.refund.realMoneyNote')}`,
      danger: true,
    })
    if (!ok) return
    setActionError(null)
    setBusyId(row.merchant_uid)
    const { error } = await refundPayment('credit_pack', row.merchant_uid)
    setBusyId(null)
    if (error) {
      setActionError(t('billing.actionError', { error }))
    } else {
      fetchBillingPayments(payPage, PAGE_SIZE)
      fetchBillingOverview()
    }
  }

  const doRefundSubscription = async (row: AdminSubscriptionRow) => {
    const ok = await confirm({
      title: t('billing.refund.confirmTitle'),
      message: `${t('billing.refund.confirmSubscription', { email: row.email || row.user_id })}\n\n${t('billing.refund.realMoneyNote')}`,
      danger: true,
    })
    if (!ok) return
    setActionError(null)
    setBusyId(row.id)
    const { error } = await refundPayment('subscription', row.id)
    setBusyId(null)
    if (error) {
      setActionError(t('billing.actionError', { error }))
    } else {
      fetchBillingSubscriptions(statusFilter || undefined, subsPage, PAGE_SIZE)
      fetchBillingOverview()
    }
  }

  const subsHasNext = billingSubscriptions.length === PAGE_SIZE
  const payHasNext = billingPayments.length === PAGE_SIZE

  if (billingError && !billingOverview) {
    return <AdminErrorState error={billingError} onRetry={refreshAll} />
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t('billing.title')}</h2>
        <button
          type="button"
          onClick={refreshAll}
          className="px-3 py-1.5 text-xs font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition cursor-pointer"
        >
          {t('common.refresh')}
        </button>
      </div>

      {actionError && (
        <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* ── Overview tiles ── */}
      {billingOverviewLoading && !billingOverview ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[...Array(7)].map((_, i) => <div key={i} className="h-20 bg-accent rounded-xl animate-pulse" />)}
        </div>
      ) : billingOverview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <AdminStatCard icon="🔁" label={t('billing.overview.activeSubscriptions')} value={billingOverview.active_subscriptions} color="green" />
          <AdminStatCard icon="⏳" label={t('billing.overview.canceling')} value={billingOverview.canceling} color="yellow" />
          <AdminStatCard icon="⚠️" label={t('billing.overview.pastDue')} value={billingOverview.past_due} color="red" />
          <AdminStatCard icon="💰" label={t('billing.overview.mrr')} value={fmtMicro(billingOverview.mrr_micro_won)} color="blue" />
          <AdminStatCard icon="👛" label={t('billing.overview.walletTotal')} value={fmtMicro(billingOverview.wallet_total_micro)} color="purple" />
          <AdminStatCard icon="📈" label={t('billing.overview.revenue30d')} value={fmtMicro(billingOverview.paid_revenue_30d_micro)} color="teal" />
          <AdminStatCard icon="↩️" label={t('billing.overview.refunds30d')} value={billingOverview.refunds_30d} color="orange" />
        </div>
      )}

      {/* ── Subscriptions ── */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">{t('billing.subscriptions.title')}</h3>
            <p className="text-[11px] text-content-tertiary mt-0.5">{t('billing.subscriptions.refundNote')}</p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setSubsPage(0) }}
            className="px-2 py-1.5 text-xs border border-border rounded-lg bg-muted cursor-pointer"
          >
            <option value="">{t('billing.subscriptions.allStatuses')}</option>
            {SUB_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`billing.status.${s}`, s)}</option>
            ))}
          </select>
        </div>
        {billingSubsLoading && billingSubscriptions.length === 0 ? (
          <p className="text-sm text-content-tertiary py-8 text-center">{t('loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.email')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.tier')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.status')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.cardLimit')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.periodEnd')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.provider')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.subscriptions.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {billingSubscriptions.map((row) => (
                  <tr key={row.id} className="hover:bg-muted align-top">
                    <td className="px-4 py-2 text-foreground">
                      <span className="block truncate max-w-[180px]" title={row.email || row.user_id}>{row.email || row.user_id}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.tier}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SUB_STATUS_STYLES[row.status] ?? 'bg-accent text-foreground'}`}>
                        {t(`billing.status.${row.status}`, row.status)}
                        {row.cancel_at_period_end && <span title={t('billing.subscriptions.canceling')}>⏳</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground tabular-nums">{row.card_limit?.toLocaleString(dateLocale) ?? '-'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.current_period_end ? formatLocalDate(row.current_period_end, dateLocale) : '-'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.provider ?? '-'}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === row.id || !row.provider_subscription_id}
                          onClick={() => doCancel(row, false)}
                          className="px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-muted cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        >
                          {t('billing.subscriptions.cancelAtPeriodEnd')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id || !row.provider_subscription_id}
                          onClick={() => doCancel(row, true)}
                          className="px-2 py-0.5 text-xs rounded bg-destructive/15 text-destructive hover:bg-destructive/25 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        >
                          {busyId === row.id ? '...' : t('billing.subscriptions.cancelImmediate')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id || !row.provider_subscription_id}
                          onClick={() => doRefundSubscription(row)}
                          className="px-2 py-0.5 text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        >
                          {t('billing.refund.button')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {billingSubscriptions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-content-tertiary">{t('billing.subscriptions.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={subsPage} hasNext={subsHasNext} onChange={setSubsPage} t={t} />
      </div>

      {/* ── Payments ── */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">{t('billing.payments.title')}</h3>
        </div>
        {billingPaymentsLoading && billingPayments.length === 0 ? (
          <p className="text-sm text-content-tertiary py-8 text-center">{t('loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.email')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.product')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.kind')}</th>
                  <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{t('billing.payments.amount')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.status')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.paidAt')}</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('billing.payments.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {billingPayments.map((row) => (
                  <tr key={row.merchant_uid} className="hover:bg-muted">
                    <td className="px-4 py-2 text-foreground">
                      <span className="block truncate max-w-[180px]" title={row.email || row.user_id}>{row.email || row.user_id}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.product_id ?? '-'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{t(`billing.kind.${row.kind}`, row.kind)}</td>
                    <td className="px-4 py-2 text-right text-foreground tabular-nums">{fmtKrw(row.amount_krw)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PAY_STATUS_STYLES[row.status] ?? 'bg-accent text-foreground'}`}>
                        {t(`billing.payStatus.${row.status}`, row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.paid_at ? formatLocalDateTime(row.paid_at, dateLocale) : '-'}</td>
                    <td className="px-4 py-2">
                      {row.status === 'paid' && row.kind === 'credit_pack' ? (
                        <button
                          type="button"
                          disabled={busyId === row.merchant_uid}
                          onClick={() => doRefundCreditPack(row)}
                          className="px-2 py-0.5 text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        >
                          {busyId === row.merchant_uid ? '...' : t('billing.refund.button')}
                        </button>
                      ) : (
                        <span className="text-content-tertiary">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {billingPayments.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-content-tertiary">{t('billing.payments.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={payPage} hasNext={payHasNext} onChange={setPayPage} t={t} />
      </div>

      {/* ── User lookup ── */}
      <UserBillingPanel />
    </div>
  )
}

/* ─────────────────────────── Pager ─────────────────────────── */

function Pager({ page, hasNext, onChange, t }: {
  page: number
  hasNext: boolean
  onChange: (p: number) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (page === 0 && !hasNext) return null
  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
      <span>{t('billing.pagination.page', { page: page + 1 })}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="px-3 py-1 rounded border border-border disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          {t('billing.pagination.prev')}
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={!hasNext}
          className="px-3 py-1 rounded border border-border disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          {t('billing.pagination.next')}
        </button>
      </div>
    </div>
  )
}

/* ────────────────────── User billing panel ────────────────────── */

function UserBillingPanel() {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = toIntlLocale(i18n.language)
  const {
    billingUser, billingUserLoading, billingUserError,
    fetchUserBilling, clearUserBilling, grantSubscription, adjustWallet,
  } = useAdminStore()
  const products = useBillingStore((s) => s.products)
  const fetchProducts = useBillingStore((s) => s.fetchProducts)

  const [userId, setUserId] = useState('')
  const [submittedId, setSubmittedId] = useState('')
  const [grantProductId, setGrantProductId] = useState('')
  const [grantPeriodEnd, setGrantPeriodEnd] = useState('')
  const [adjustWon, setAdjustWon] = useState('')
  const [adjustReason, setAdjustReason] = useState('admin_adjustment')
  const [busy, setBusy] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  useEffect(() => { fetchProducts() }, [fetchProducts])
  useEffect(() => () => { clearUserBilling() }, [clearUserBilling])

  const subProducts = useMemo(() => products.filter((p) => p.kind === 'subscription'), [products])

  const fmtMicro = (micro: number) => `₩${microWonToWon(micro).toLocaleString(dateLocale)}`
  const fmtKrw = (won: number) => `₩${(won ?? 0).toLocaleString(dateLocale)}`

  const idValid = UUID_RE.test(userId.trim())

  const doLookup = () => {
    const id = userId.trim()
    if (!UUID_RE.test(id)) { setPanelError(t('billing.user.invalidId')); return }
    setPanelError(null)
    setSubmittedId(id)
    fetchUserBilling(id)
  }

  const doGrant = async () => {
    if (!submittedId || !grantProductId) return
    const prod = subProducts.find((p) => p.id === grantProductId)
    if (!(await confirm({
      title: t('billing.user.confirmGrantTitle'),
      message: t('billing.user.confirmGrant', { product: prod?.title ?? grantProductId }),
    }))) return
    setPanelError(null)
    setBusy(true)
    const { error } = await grantSubscription(submittedId, grantProductId, grantPeriodEnd ? new Date(grantPeriodEnd).toISOString() : null)
    setBusy(false)
    if (error) setPanelError(t('billing.actionError', { error }))
    else fetchUserBilling(submittedId)
  }

  const doAdjust = async () => {
    if (!submittedId) return
    const won = Number(adjustWon)
    if (!Number.isFinite(won) || won === 0) { setPanelError(t('billing.user.invalidAmount')); return }
    if (!(await confirm({
      title: t('billing.user.confirmAdjustTitle'),
      message: t('billing.user.confirmAdjust', { amount: won.toLocaleString(dateLocale) }),
      danger: won < 0,
    }))) return
    setPanelError(null)
    setBusy(true)
    const { error } = await adjustWallet(submittedId, Math.round(won * 1_000_000), adjustReason || 'admin_adjustment')
    setBusy(false)
    if (error) setPanelError(t('billing.actionError', { error }))
    else { setAdjustWon(''); fetchUserBilling(submittedId) }
  }

  const sub = billingUser?.subscription ?? null

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{t('billing.user.title')}</h3>
      </div>
      <div className="p-4 space-y-4">
        {/* Lookup input */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder={t('billing.user.searchPlaceholder')}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doLookup() }}
            className="px-3 py-1.5 text-xs border border-border rounded-lg bg-muted focus:outline-none focus:ring-1 focus:ring-brand w-72 font-mono"
          />
          <button
            type="button"
            onClick={doLookup}
            disabled={!idValid || billingUserLoading}
            className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {billingUserLoading ? t('loading') : t('billing.user.lookup')}
          </button>
          {submittedId && (
            <button
              type="button"
              onClick={() => { setSubmittedId(''); setUserId(''); clearUserBilling(); setPanelError(null) }}
              className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {t('billing.user.clear')}
            </button>
          )}
        </div>

        {panelError && (
          <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive">{panelError}</div>
        )}
        {billingUserError && (
          <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive">{billingUserError}</div>
        )}

        {submittedId && billingUser && (
          <div className="space-y-4">
            {/* Subscription + wallet */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('billing.user.subscription')}</p>
                {sub ? (
                  <div className="text-sm text-foreground space-y-0.5">
                    <p><span className="font-medium">{sub.tier}</span> · <span className={`px-1.5 py-0.5 rounded text-xs ${SUB_STATUS_STYLES[sub.status] ?? 'bg-accent text-foreground'}`}>{t(`billing.status.${sub.status}`, sub.status)}</span></p>
                    <p className="text-xs text-muted-foreground">{t('billing.subscriptions.cardLimit')}: {sub.card_limit?.toLocaleString(dateLocale) ?? '-'}</p>
                    <p className="text-xs text-muted-foreground">{t('billing.subscriptions.periodEnd')}: {sub.current_period_end ? formatLocalDate(sub.current_period_end, dateLocale) : '-'}</p>
                    <p className="text-xs text-muted-foreground">{t('billing.subscriptions.provider')}: {sub.provider ?? '-'}{sub.cancel_at_period_end ? ` · ${t('billing.subscriptions.canceling')}` : ''}</p>
                  </div>
                ) : (
                  <p className="text-sm text-content-tertiary">{t('billing.user.noSubscription')}</p>
                )}
              </div>
              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t('billing.user.wallet')}</p>
                <p className="text-2xl font-bold text-foreground tabular-nums">{fmtMicro(billingUser.wallet_micro)}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Grant subscription */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">{t('billing.user.grant')}</p>
                <select
                  value={grantProductId}
                  onChange={(e) => setGrantProductId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-muted cursor-pointer"
                >
                  <option value="">{t('billing.user.grantProduct')}</option>
                  {subProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.title} · {fmtKrw(p.priceKrw)}</option>
                  ))}
                </select>
                <label className="block text-[11px] text-muted-foreground">{t('billing.user.grantPeriodEnd')}</label>
                <input
                  type="date"
                  value={grantPeriodEnd}
                  onChange={(e) => setGrantPeriodEnd(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-muted"
                />
                <button
                  type="button"
                  onClick={doGrant}
                  disabled={busy || !grantProductId}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  {t('billing.user.grantSubmit')}
                </button>
              </div>

              {/* Adjust wallet */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">{t('billing.user.adjustWallet')}</p>
                <label className="block text-[11px] text-muted-foreground">{t('billing.user.adjustAmount')}</label>
                <input
                  type="number"
                  value={adjustWon}
                  onChange={(e) => setAdjustWon(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-muted tabular-nums"
                />
                <label className="block text-[11px] text-muted-foreground">{t('billing.user.adjustReason')}</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-muted"
                />
                <button
                  type="button"
                  onClick={doAdjust}
                  disabled={busy || !adjustWon}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  {t('billing.user.adjustSubmit')}
                </button>
              </div>
            </div>

            {/* Ledger */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">{t('billing.user.ledger')}</p>
              {billingUser.ledger.length === 0 ? (
                <p className="text-xs text-content-tertiary">{t('billing.user.empty')}</p>
              ) : (
                <ul className="divide-y divide-border border border-border rounded-lg">
                  {billingUser.ledger.map((e, i) => {
                    const positive = e.delta >= 0
                    return (
                      <li key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div>
                          <p className="text-foreground">{t(`billing.reason.${e.reason}`, { defaultValue: e.reason })}</p>
                          <p className="text-content-tertiary">{formatLocalDateTime(e.created_at, dateLocale)}</p>
                        </div>
                        <div className="text-right">
                          <span className={`font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}>
                            {positive ? '+' : '−'}{fmtMicro(Math.abs(e.delta))}
                          </span>
                          <p className="text-content-tertiary tabular-nums">{fmtMicro(e.balance_after)}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* User payments */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">{t('billing.user.payments')}</p>
              {billingUser.payments.length === 0 ? (
                <p className="text-xs text-content-tertiary">{t('billing.user.empty')}</p>
              ) : (
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('billing.payments.product')}</th>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('billing.payments.kind')}</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium text-muted-foreground">{t('billing.payments.amount')}</th>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('billing.payments.status')}</th>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('billing.payments.paidAt')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {billingUser.payments.map((p) => (
                        <tr key={p.merchant_uid}>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.product_id ?? '-'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{t(`billing.kind.${p.kind}`, p.kind)}</td>
                          <td className="px-3 py-1.5 text-right text-foreground tabular-nums">{fmtKrw(p.amount_krw)}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block px-1.5 py-0.5 rounded-full ${PAY_STATUS_STYLES[p.status] ?? 'bg-accent text-foreground'}`}>
                              {t(`billing.payStatus.${p.status}`, p.status)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.paid_at ? formatLocalDateTime(p.paid_at, dateLocale) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {submittedId && !billingUser && !billingUserLoading && !billingUserError && (
          <p className="text-sm text-content-tertiary">{t('billing.user.notFound')}</p>
        )}
      </div>
    </div>
  )
}
