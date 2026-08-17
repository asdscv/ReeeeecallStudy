import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  formatUsdMicro,
  getAiUsageHistory,
  type WalletUsageRow,
} from '@reeeeecall/shared/lib/ai/server-client'
import { toIntlLocale } from '../../lib/locale-utils'

const PAGE = 30

// Wallet "usage history" (사용 내역) with infinite scroll.
//
// Reads `get_ai_usage_history` (mig 251), which is a balance movement OR a use that cost
// nothing. It used to read the credit ledger alone, so a learner who made cards inside the
// free daily ten opened this and found it empty — the AI had run, the history had nothing to
// say about it. Free rows carry `isFree` and print 무료 where an amount would go.
//
// Paged by TIMESTAMP rather than a row id: the list is a union of two tables whose ids do not
// interleave. `refreshKey` reloads page 1 when it changes (e.g. after a generation) so a new
// entry appears without a manual reload.
//
// The rows live in their OWN bounded scroll pane rather than page-flip pagination:
// paging makes you hunt for a transaction across numbered pages, and unbounded
// in-page growth pushed every Settings section below it off-screen. A fixed-height
// pane keeps Settings navigable while still reaching the full ledger — scroll inside
// it and older pages load automatically (the observer roots on the pane, not the
// viewport, so it fires on the pane's own scroll).
export function CreditLedgerList({ refreshKey }: { refreshKey?: number | string }) {
  const { t, i18n } = useTranslation('wallet')
  const [rows, setRows] = useState<WalletUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const busyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<HTMLDivElement | null>(null)

  const dateLocale = toIntlLocale(i18n.language)
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  // Append the next older page (cursor = the oldest timestamp currently held).
  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return
    busyRef.current = true
    setLoading(true)
    const cursor = rows.length ? rows[rows.length - 1].createdAt : undefined
    const page = await getAiUsageHistory(cursor, PAGE)
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
    void getAiUsageHistory(undefined, PAGE).then((page) => {
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

  // Load older pages as the sentinel scrolls into view. Root on the scroll pane so the
  // trigger is the PANE's scroll position, not the document's.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { root: paneRef.current, rootMargin: '120px' },
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
        <div
          ref={paneRef}
          // Bounded pane: ~5 rows tall, scrolls to the rest. overscroll-contain stops a
          // scroll that hits the bottom from continuing into the page behind it.
          className="max-h-72 overflow-y-auto overscroll-contain pr-1"
        >
          <ul className="divide-y divide-border">
            {rows.map((e, i) => {
              const positive = e.delta >= 0
              // How many cards this row covers, when it is about cards at all. A row that
              // reads "AI 카드 생성 · 10장 · 무료" answers the question the bare label could
              // not: which of today's free ten this was.
              const cards = e.freeCards + e.paidCards
              return (
                // Two rows CAN share a timestamp (a job and its ledger entry are written in one
                // transaction), so the index is part of the key. The list is append-only per
                // page, so this cannot reorder under React.
                <li key={`${e.createdAt}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {t(`reason.${e.kind}`, { defaultValue: e.kind })}
                      {cards > 0 && (
                        <span className="ml-1.5 text-xs text-content-tertiary">
                          {t('history.cards', { count: cards })}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</p>
                  </div>
                  {e.isFree ? (
                    /* Not "−$0.00". A zero amount reads as a rounding artefact; the learner
                       needs to know it came out of the daily free allowance instead. */
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-content-tertiary">
                      {t('history.free')}
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}
                    >
                      {positive ? '+' : '−'}
                      {formatUsdMicro(Math.abs(e.delta))}
                    </span>
                  )}
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
      )}
    </div>
  )
}
