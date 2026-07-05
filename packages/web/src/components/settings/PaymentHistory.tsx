import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toIntlLocale } from '../../lib/locale-utils'
import { useBillingStore } from '../../stores/billing-store'

const PAGE = 20

interface PaymentRow {
  merchantUid: string
  productId: string
  kind: string
  amountKrw: number
  status: string
  createdAt: string
}

interface RawPaymentIntentRow {
  merchant_uid: string
  product_id: string
  kind: string
  amount_krw: number
  status: string
  created_at: string
}

// Payment / order history (결제 내역) — credit-pack purchases AND subscription
// purchases, read straight from payment_intents (RLS: user selects own rows). Offset
// pagination via .range() with infinite scroll; low row counts make keyset overkill.
// NOTE: this lists the INITIAL purchase of each order; recurring subscription renewals
// aren't itemized here yet (they arrive as invoice webhooks, not new intents).
export function PaymentHistory() {
  const { t, i18n } = useTranslation('billing')
  const products = useBillingStore((s) => s.products)
  const fetchProducts = useBillingStore((s) => s.fetchProducts)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const busyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const dateLocale = toIntlLocale(i18n.language)
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })
  const fmtUsd = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

  // Titles/prices come from the catalog cache (get_billing_products); a retired plan
  // that's no longer in the catalog falls back to its product id.
  useEffect(() => {
    if (products.length === 0) void fetchProducts()
  }, [products.length, fetchProducts])

  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return
    busyRef.current = true
    setLoading(true)
    const from = rows.length
    const { data } = await supabase
      .from('payment_intents')
      .select('merchant_uid, product_id, kind, amount_krw, status, created_at')
      .in('status', ['paid', 'refunded'])
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    const page: PaymentRow[] = ((data ?? []) as RawPaymentIntentRow[]).map((r) => ({
      merchantUid: r.merchant_uid,
      productId: r.product_id,
      kind: r.kind,
      amountKrw: Number(r.amount_krw ?? 0),
      status: r.status,
      createdAt: r.created_at,
    }))
    setRows((prev) => [...prev, ...page])
    setHasMore(page.length === PAGE)
    setLoading(false)
    busyRef.current = false
  }, [rows.length, hasMore])

  // Page 1 on mount.
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

  const titleFor = (productId: string) => products.find((p) => p.id === productId)?.title ?? productId
  const priceFor = (productId: string) => products.find((p) => p.id === productId)?.priceUsdCents ?? null

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
        {rows.map((r) => (
          <li key={r.merchantUid} className="flex items-center justify-between py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm text-foreground">{titleFor(r.productId)}</p>
                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t(`paymentHistory.kind.${r.kind}`, { defaultValue: r.kind })}
                </span>
                {r.status === 'refunded' && (
                  <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">
                    {t('paymentHistory.refunded')}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              {fmtUsd(priceFor(r.productId))}
            </span>
          </li>
        ))}
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
