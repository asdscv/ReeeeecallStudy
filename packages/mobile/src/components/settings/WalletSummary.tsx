import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, Pressable, Linking } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import {
  getAiWalletSummary,
  getAiUsageHistory,
  formatUsdMicro,
  type AiWalletSummary,
  type WalletUsageRow,
} from '@reeeeecall/shared/lib/ai/server-client'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'
import { Button } from '../ui'
import { usePurchases } from '../../hooks/usePurchases'
import { purchaseService, SUBSCRIPTION_UI_ENABLED } from '../../services/purchases'
import { recordPurchaseConsent } from '../../services/billing'
import type { BillingProduct } from '../../services/billing'

// Ledger rows shown before the "show all" toggle.
const HISTORY_PREVIEW = 5

const REFUND_POLICY_URL = 'https://reeeeecallstudy.xyz/refund-policy.html'

// AI wallet / usage content for the mobile Settings accordion (충전금·사용량):
// $ balance + today's free-tier usage + recent history (get_ai_wallet_summary, mig
// 117). The parent CollapsibleSection only mounts this when expanded. Top-up disabled
// (payment Phase 2 on hold). Mirrors the web WalletSummary.
export function WalletSummary() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('wallet')
  const [summary, setSummary] = useState<AiWalletSummary | null>(null)
  /**
   * 사용 내역 — 잔액이 움직인 것 **과** 무료로 쓴 것.
   *
   * 요약 RPC 의 `ledger` 는 잔액 변동만 담습니다. 그래서 무료 10장 안에서 카드를 만든 학습자가
   * 이 화면을 열면 아무것도 없었습니다. `get_ai_usage_history`(mig 251)가 둘을 합칩니다.
   */
  const [history, setHistory] = useState<WalletUsageRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyExpanded, setHistoryExpanded] = useState(false)
  // Withdrawal-right disclosure, required before the pack buttons unlock. Credits are
  // consumable digital content: KR 전자상거래법 / EU-UK only let us treat a used pack as
  // non-refundable if the buyer saw this notice BEFORE paying (mig 157).
  const [consented, setConsented] = useState(false)

  const load = useCallback(() => {
    setState('loading')
    getAiWalletSummary().then((s) => {
      if (s) { setSummary(s); setState('ready') } else { setState('error') }
    })
    // 별도 호출입니다. 요약이 실패해도 내역은 보여줄 수 있고, 반대도 마찬가지입니다 —
    // 잔액을 못 읽었다고 "오늘 무엇을 했는지"까지 감출 이유는 없습니다.
    getAiUsageHistory(undefined, 30).then(setHistory)
  }, [])
  useEffect(() => { load() }, [load])

  // Credit-pack top-up (mobile IAP, consumable). The catalog + store package come
  // from usePurchases (short-circuits to empty while the payment gate is off).
  const { products, offering, purchasing, purchase } = usePurchases()
  const creditPacks = products
    .filter((p) => p.kind === 'credit_pack')
    .sort((a, b) => (a.priceUsdCents ?? 0) - (b.priceUsdCents ?? 0))

  // The store IAP id to purchase for this platform (billing_product_skus, mig 151);
  // fall back to the internal id when no SKU row is registered yet.
  const storeSku = (product: BillingProduct): string => product.storeProductId ?? product.id

  // Show the STORE-localized price the buyer actually pays (Apple/Google charge in
  // local currency), falling back to the catalog USD if the package hasn't loaded.
  const storePrice = (product: BillingProduct): string =>
    purchaseService.findPackageForProduct(offering, storeSku(product))?.product?.priceString
      ?? formatProductPrice(product)

  const buyPack = async (product: BillingProduct) => {
    const pkg = purchaseService.findPackageForProduct(offering, storeSku(product))
    if (!pkg) { Alert.alert(t('credits.title'), t('credits.unavailable')); return }
    // Stamp the disclosure BEFORE the store charge — mig 157 only counts a consent
    // recorded before the purchase, since one written afterwards proves nothing.
    await recordPurchaseConsent(product.id)
    // purchase() settles the store transaction; the credit GRANT lands server-side
    // via the RevenueCat webhook (add_ai_credits, idempotent). Re-poll the wallet so
    // the new balance shows once the webhook has processed.
    const result = await purchase(pkg, product)
    if (result.success) {
      load()
      Alert.alert(t('credits.title'), t('credits.confirming'))
    } else if (result.error && result.error !== 'cancelled' && result.error !== 'disabled') {
      Alert.alert(t('credits.title'), result.error)
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  if (state === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
  }
  if (state === 'error' || !summary) {
    return (
      <View style={styles.center}>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 12 }]}>{t('error')}</Text>
        <TouchableOpacity onPress={load} style={[styles.btn, { backgroundColor: theme.colors.primary }]}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{t('retry')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const freePct = Math.min(100, Math.round((summary.freeUsedToday / Math.max(1, summary.freeLimit)) * 100))

  return (
    <View style={{ gap: 20 }}>
      {/* Balance */}
      <View>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('balance.title')}</Text>
        <Text style={[styles.balance, { color: theme.colors.text }]}>{formatUsdMicro(summary.balanceMicroUsd)}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>{t('balance.hint')}</Text>

        {SUBSCRIPTION_UI_ENABLED && creditPacks.length > 0 ? (
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={[styles.subTitle, { color: theme.colors.text }]}>{t('credits.title')}</Text>
            <Pressable
              testID="wallet-consent"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consented }}
              onPress={() => setConsented((v) => !v)}
              style={[styles.consent, { borderColor: theme.colors.border }]}
            >
              <Text style={[styles.consentBox, { color: consented ? theme.colors.primary : theme.colors.textTertiary }]}>
                {consented ? '☑' : '☐'}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, flex: 1 }]}>
                {t('consent.creditPack')}{' '}
                <Text
                  style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                  onPress={() => Linking.openURL(REFUND_POLICY_URL)}
                >
                  {t('consent.policyLink')}
                </Text>
              </Text>
            </Pressable>
            {creditPacks.map((pack) => (
              <View key={pack.id} style={styles.packRow}>
                {/* what you GET (fixed USD credit) — the price BELOW is what you PAY
                    (store-localized, may differ by country) */}
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t('credits.creditLabel', { value: pack.title })}
                </Text>
                <Button
                  testID={`wallet-buy-${pack.id}`}
                  title={storePrice(pack)}
                  size="sm"
                  onPress={() => buyPack(pack)}
                  loading={purchasing}
                  disabled={!consented}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.btn, { backgroundColor: theme.colors.border, marginTop: 10, opacity: 0.7 }]}>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{t('balance.topUp')}</Text>
          </View>
        )}
      </View>

      {/* Free today */}
      <View style={{ paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
        <View style={styles.row}>
          <Text style={[styles.subTitle, { color: theme.colors.text }]}>{t('free.title')}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('free.count', { used: summary.freeUsedToday, limit: summary.freeLimit })}
          </Text>
        </View>
        <View style={styles.bar}>
          <View style={{
            height: '100%', borderRadius: 4,
            width: `${freePct}%`,
            backgroundColor: summary.freeRemainingToday <= 0 ? theme.colors.error : theme.colors.primary,
          }} />
        </View>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 8 }]}>{t('free.note')}</Text>
      </View>

      {/* Quiz allowance — a separate currency from the card numbers above: quiz is metered
          in units, and the one-time trial is not a daily reset. Hidden entirely when quiz
          free usage is off, so it never renders a row of zeroes at someone who cannot use it. */}
      {(summary.quizFreeLimit > 0 || summary.quizTrialRemaining > 0) && (
        <View style={{ paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.subTitle, { color: theme.colors.text }]}>{t('quiz.title')}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {t('quiz.freeCount', { used: summary.quizFreeUsedToday, limit: summary.quizFreeLimit })}
            </Text>
          </View>
          {summary.quizTrialRemaining > 0 && (
            <Text style={[theme.typography.caption, { color: theme.colors.primary, marginTop: 4 }]}>
              {t('quiz.trial', { count: summary.quizTrialRemaining })}
            </Text>
          )}
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 4 }]}>
            {t('quiz.note')}
          </Text>
        </View>
      )}

      {/* History — collapsed to the most recent HISTORY_PREVIEW entries with a
          show-all toggle, rather than paginated. Settings is one long ScrollView, so
          dumping all 30 ledger rows buried every section below it; and page-flipping
          inside a scrolling page is worse on touch than one expand tap. The list is
          server-capped at 30 (mig 117), so expanded is still bounded. */}
      <View style={{ paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
        <Text style={[styles.subTitle, { color: theme.colors.text, marginBottom: 8 }]}>{t('history.title')}</Text>
        {history.length === 0 ? (
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 8 }]}>{t('history.empty')}</Text>
        ) : (
          <>
            {(historyExpanded ? history : history.slice(0, HISTORY_PREVIEW)).map((e, i) => {
              const positive = e.delta >= 0
              const cards = e.freeCards + e.paidCards
              return (
                <View
                  key={i}
                  style={[styles.ledgerRow, { borderTopColor: theme.colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.body, { color: theme.colors.text }]}>
                      {t(`reason.${e.kind}`, { defaultValue: e.kind })}
                      {cards > 0 ? ` · ${t('history.cards', { count: cards })}` : ''}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{fmtDate(e.createdAt)}</Text>
                  </View>
                  {/* "−$0.00" 이 아니라 "무료". 0원은 반올림 자국처럼 읽히고, 학습자가 알아야
                      하는 것은 그게 하루 무료분에서 나갔다는 사실입니다. */}
                  {e.isFree ? (
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' }]}>
                      {t('history.free')}
                    </Text>
                  ) : (
                    <Text style={{ fontWeight: '600', color: positive ? theme.colors.success : theme.colors.error }}>
                      {positive ? '+' : '−'}{formatUsdMicro(Math.abs(e.delta))}
                    </Text>
                  )}
                </View>
              )
            })}
            {history.length > HISTORY_PREVIEW && (
              <TouchableOpacity
                testID="wallet-history-toggle"
                onPress={() => setHistoryExpanded((v) => !v)}
                style={[styles.historyToggle, { borderTopColor: theme.colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
                  {historyExpanded
                    ? t('history.showLess')
                    : t('history.showAll', { total: history.length })}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { paddingVertical: 24, alignItems: 'center' },
  balance: { fontSize: 28, fontWeight: '700', marginTop: 2 },
  subTitle: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(128,128,128,0.2)' },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', alignSelf: 'flex-start' },
  packRow: { gap: 4 },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderWidth: 1, borderRadius: 10 },
  consentBox: { fontSize: 18, lineHeight: 20 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  historyToggle: { paddingTop: 10, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
})
