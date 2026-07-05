import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toIntlLocale } from '../../lib/locale-utils'

const PAGE = 20

interface HistoryRow {
  ref: string
  source: string
  title: string
  kind: string
  amountUsdCents: number | null
  billingReason: string | null
  status: string
  createdAt: string
}

interface RawHistoryRow {
  ref: string
  source: string
  product_id: string
  title: string
  kind: string
  amount_usd_cents: number | null
  billing_reason: string | null
  status: string
  created_at: string
}

// Payment / order history (결제 내역) — credit-pack purchases, the initial
// subscription purchase, AND recurring subscription RENEWALS, merged chronologically
// by get_my_payment_history (mig 131): payment_intents (initial, both kinds) ∪
// billing_invoices (billing_reason <> 'initial'). Keyset pagination on created_at
// (pass the oldest row's timestamp as the cursor), infinite scroll.
export function PaymentHistory() {
  const { t, i18n } = useTranslation('billing')
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const busyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const dateLocale = toIntlLocale(i18n.language)
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const fmtUsd = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return
    busyRef.current = true
    setLoading(true)
    const before = rows.length ? rows[rows.length - 1].createdAt : null
    const { data } = await supabase.rpc('get_my_payment_history', { p_limit: PAGE, p_before: before })
    const page: HistoryRow[] = ((data ?? []) as RawHistoryRow[]).map((r) => ({
      ref: r.ref,
      source: r.source,
      title: r.title,
      kind: r.kind,
      amountUsdCents: r.amount_usd_cents,
      billingReason: r.billing_reason,
      status: r.status,
      createdAt: r.created_at,
    }))
    setRows((prev) => [...prev, ...page])
    setHasMore(page.length === PAGE)
    setLoading(false)
    busyRef.current = false
  }, [rows, hasMore])

  useEffect(() => {
    void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  if (rows.length === 0 && loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">{t('paymentHistory.empty')}</p>
  }

  return (
    <div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          // 'renewal'/'updated' invoices get a badge; the initial purchase (order) has none.
          const reasonBadge =
            r.billingReason && r.billingReason !== 'initial'
              ? t(`paymentHistory.reason.${r.billingReason}`, { defaultValue: '' })
              : ''
          return (
            <li key={`${r.source}:${r.ref}`} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm text-foreground">{r.title}</p>
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t(`paymentHistory.kind.${r.kind}`, { defaultValue: r.kind })}
                  </span>
                  {reasonBadge && (
                    <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] text-brand">
                      {reasonBadge}
                    </span>
                  )}
                  {r.status === 'refunded' && (
                    <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">
                      {t('paymentHistory.refunded')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {fmtUsd(r.amountUsdCents)}
              </span>
            </li>
          )
        })}
      </ul>
      {hasMore && <div ref={sentinelRef} className="h-1" />}
      {loading && (
        <div className="flex items-center justify-center py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  )
}
