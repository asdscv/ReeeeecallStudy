import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import {
  getAiWalletSummary,
  formatUsdMicro,
  type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'
import { Button } from '../ui'
import { usePurchases } from '../../hooks/usePurchases'
import { purchaseService, SUBSCRIPTION_UI_ENABLED } from '../../services/purchases'
import type { BillingProduct } from '../../services/billing'

// AI wallet / usage content for the mobile Settings accordion (충전금·사용량):
// $ balance + today's free-tier usage + recent history (get_ai_wallet_summary, mig
// 117). The parent CollapsibleSection only mounts this when expanded. Top-up disabled
// (payment Phase 2 on hold). Mirrors the web WalletSummary.
export function WalletSummary() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('wallet')
  const [summary, setSummary] = useState<AiWalletSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(() => {
    setState('loading')
    getAiWalletSummary().then((s) => {
      if (s) { setSummary(s); setState('ready') } else { setState('error') }
    })
  }, [])
  useEffect(() => { load() }, [load])

  // Credit-pack top-up (mobile IAP, consumable). The catalog + store package come
  // from usePurchases (short-circuits to empty while the payment gate is off).
  const { products, offering, purchasing, purchase } = usePurchases()
  const creditPacks = products
    .filter((p) => p.kind === 'credit_pack')
    .sort((a, b) => (a.priceUsdCents ?? 0) - (b.priceUsdCents ?? 0))

  // Show the STORE-localized price the buyer actually pays (Apple/Google charge in
  // local currency), falling back to the catalog USD if the package hasn't loaded.
  const storePrice = (product: BillingProduct): string =>
    purchaseService.findPackageForProduct(offering, product.id)?.product?.priceString
      ?? formatProductPrice(product)

  const buyPack = async (product: BillingProduct) => {
    const pkg = purchaseService.findPackageForProduct(offering, product.id)
    if (!pkg) { Alert.alert(t('credits.title'), t('credits.unavailable')); return }
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
        <Text style={[styles.balance, { color: theme.colors.text }]}>{formatUsdMicro(summary.balanceMicroWon)}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>{t('balance.hint')}</Text>

        {SUBSCRIPTION_UI_ENABLED && creditPacks.length > 0 ? (
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={[styles.subTitle, { color: theme.colors.text }]}>{t('credits.title')}</Text>
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

      {/* History */}
      <View style={{ paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
        <Text style={[styles.subTitle, { color: theme.colors.text, marginBottom: 8 }]}>{t('history.title')}</Text>
        {summary.ledger.length === 0 ? (
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 8 }]}>{t('history.empty')}</Text>
        ) : (
          summary.ledger.map((e, i) => {
            const positive = e.delta >= 0
            return (
              <View
                key={i}
                style={[styles.ledgerRow, { borderTopColor: theme.colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t(`reason.${e.reason}`, { defaultValue: e.reason })}</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{fmtDate(e.createdAt)}</Text>
                </View>
                <Text style={{ fontWeight: '600', color: positive ? theme.colors.success : theme.colors.error }}>
                  {positive ? '+' : '−'}{formatUsdMicro(Math.abs(e.delta))}
                </Text>
              </View>
            )
          })
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
  ledgerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
})
