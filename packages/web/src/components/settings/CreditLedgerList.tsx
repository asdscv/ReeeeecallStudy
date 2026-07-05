import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  microWonToWon,
  getAiCreditLedger,
  type WalletLedgerRow,
} from '@reeeeecall/shared/lib/ai/server-client'
import { toIntlLocale } from '../../lib/locale-utils'

const PAGE = 30

// Wallet "usage history" (사용 내역) with infinite scroll. Pages the AI credit ledger
// via get_ai_credit_ledger (mig 130) using a keyset cursor (the smallest id seen), so
// it scales past the summary's fixed 30-row inline list. `refreshKey` reloads page 1
// when it changes (e.g. the balance moved after a top-up/spend) so a new entry appears
// without a manual reload.
export function CreditLedgerList({ refreshKey }: { refreshKey?: number | string }) {
  const { t, i18n } = useTranslation('wallet')
  const [rows, setRows] = useState<WalletLedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const busyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const dateLocale = toIntlLocale(i18n.language)
  const fmtWon = (won: number) => `₩${won.toLocaleString(dateLocale)}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  // Append the next older page (keyset cursor = smallest id currently held).
  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return
    busyRef.current = true
    setLoading(true)
    const cursor = rows.length ? rows[rows.length - 1].id : undefined
    const page = await getAiCreditLedger(cursor, PAGE)
    setRows((prev) => [...prev, ...page])
    setHasMore(page.length === PAGE)
    setLoading(false)
    busyRef.current = false
  }, [rows, hasMore])

  // (Re)load page 1 on mount and whenever refreshKey changes (balance moved).
  useEffect(() => {
    let alive = true
    busyRef.current = true
    setLoading(true)
    void getAiCreditLedger(undefined, PAGE).then((page) => {
      if (!alive) return
      setRows(page)
      setHasMore(page.length === PAGE)
      setLoading(false)
      busyRef.current = false
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Load older pages as the sentinel scrolls into view.
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

  return (
    <div className="pt-4 border-t border-border">
      <p className="text-sm font-semibold text-foreground mb-2">{t('history.title')}</p>
      {rows.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground py-2 text-center">{t('history.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((e) => {
            const positive = e.delta >= 0
            return (
              <li key={e.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm text-foreground">
                    {t(`reason.${e.reason}`, { defaultValue: e.reason })}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</p>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}
                >
                  {positive ? '+' : '−'}
                  {fmtWon(microWonToWon(Math.abs(e.delta)))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {hasMore && <div ref={sentinelRef} className="h-1" />}
      {loading && (
        <div className="flex items-center justify-center py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  )
}
