import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { formatCount, formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { getMyPaymentHistory, type PaymentHistoryRow } from '../../services/billing'

// Rows per fetch. Small on mobile: Settings is one long ScrollView, so the first screen
// should be short and the user pulls more only if they want it.
const PAGE = 10

/**
 * Payment / order history (결제 내역) for the mobile Settings accordion — the mirror of
 * web PaymentHistory. Credit-pack purchases, the initial subscription purchase, AND
 * recurring renewals, merged by get_my_payment_history (mig 131). Store IAP purchases
 * appear here too: the RevenueCat webhook confirms the payment_intent the client created
 * before checkout, so the same rows back both platforms.
 *
 * Load-more (append) instead of page-flipping: this list lives INSIDE the Settings
 * ScrollView, so a nested scroll pane would fight the parent and numbered pages would
 * make you hunt for a receipt. One growing list, one "load more" tap.
 */
export function PaymentHistory() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('settings')
  const [rows, setRows] = useState<PaymentHistoryRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  // Guards a second fetch while one is in flight (double-tap on "load more").
  const busyRef = useRef(false)

  const loadFirst = useCallback(async () => {
    busyRef.current = true
    setState('loading')
    const page = await getMyPaymentHistory(PAGE)
    if (page === null) {
      // Read failed — show retry, NOT "no payments yet" (see getMyPaymentHistory).
      setState('error')
    } else {
      setRows(page)
      setHasMore(page.length === PAGE)
      setState('ready')
    }
    busyRef.current = false
  }, [])

  useEffect(() => { void loadFirst() }, [loadFirst])

  const loadMore = async () => {
    if (busyRef.current || !hasMore || rows.length === 0) return
    busyRef.current = true
    setLoadingMore(true)
    // Keyset cursor: the oldest row we hold. Beats OFFSET here — a refund or a renewal
    // landing mid-scroll would shift an offset window and repeat/skip a row.
    const page = await getMyPaymentHistory(PAGE, rows[rows.length - 1].createdAt)
    // A failed load-more keeps the rows already on screen and leaves the button up to
    // retry — dropping to the error screen would throw away what the user can see.
    if (page !== null) {
      setRows((prev) => {
        const seen = new Set(prev.map((r) => `${r.source}:${r.ref}`))
        return [...prev, ...page.filter((r) => !seen.has(`${r.source}:${r.ref}`))]
      })
      setHasMore(page.length === PAGE)
    }
    setLoadingMore(false)
    busyRef.current = false
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  // The store charges USD everywhere (LemonSqueezy web / App Store / Play) → render $
  // via the shared micro-USD formatter (cents → micro is ×10_000), which groups
  // thousands without Intl. Fall back to ₩ for a legacy ₩-only row so it never shows $0.00.
  const fmtAmount = (r: PaymentHistoryRow) =>
    r.amountUsdCents != null
      ? formatUsdMicro(r.amountUsdCents * 10_000)
      : `₩${formatCount(r.amountKrw ?? 0)}`

  if (state === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
  }
  if (state === 'error') {
    return (
      <View style={styles.center}>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 12 }]}>
          {t('paymentHistory.error')}
        </Text>
        <TouchableOpacity onPress={() => void loadFirst()} style={[styles.retry, { backgroundColor: theme.colors.primary }]}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{t('paymentHistory.retry')}</Text>
        </TouchableOpacity>
      </View>
    )
  }
  if (rows.length === 0) {
    return (
      <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 8 }]}>
        {t('paymentHistory.empty')}
      </Text>
    )
  }

  return (
    <View>
      {rows.map((r, i) => {
        // 'renewal'/'updated' invoices get a badge; the initial purchase has none.
        const reasonBadge = r.billingReason && r.billingReason !== 'initial'
          ? t(`paymentHistory.reason.${r.billingReason}`, { defaultValue: '' })
          : ''
        return (
          <View
            key={`${r.source}:${r.ref}`}
            style={[styles.row, {
              borderTopColor: theme.colors.border,
              borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            }]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <View style={styles.titleRow}>
                <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>
                  {r.title}
                </Text>
                <View style={[styles.chip, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t(`paymentHistory.kind.${r.kind}`, { defaultValue: r.kind })}
                  </Text>
                </View>
                {reasonBadge ? (
                  <View style={[styles.chip, { backgroundColor: theme.colors.primary + '22' }]}>
                    <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>{reasonBadge}</Text>
                  </View>
                ) : null}
                {r.status === 'refunded' ? (
                  <View style={[styles.chip, { backgroundColor: theme.colors.errorLight }]}>
                    <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
                      {t('paymentHistory.refunded')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
                {fmtDate(r.createdAt)}
              </Text>
            </View>
            <Text style={{ fontWeight: '600', color: theme.colors.text }}>{fmtAmount(r)}</Text>
          </View>
        )
      })}

      {hasMore && (
        <TouchableOpacity
          testID="payment-history-load-more"
          onPress={() => void loadMore()}
          disabled={loadingMore}
          accessibilityRole="button"
          style={[styles.loadMore, { borderTopColor: theme.colors.border }]}
        >
          {loadingMore ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
              {t('paymentHistory.loadMore')}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { paddingVertical: 24, alignItems: 'center' },
  retry: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  loadMore: { paddingTop: 12, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
})
