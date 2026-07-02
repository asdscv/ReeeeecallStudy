import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import {
  getAiWalletSummary,
  microWonToWon,
  type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'

// User-facing AI wallet / usage screen: prepaid ₩ balance (충전금), today's free-tier
// usage, and recent spend/top-up history (get_ai_wallet_summary, mig 117). Mirrors the
// web WalletPage. Top-up is disabled — payment (Phase 2) is on hold.
export function WalletScreen() {
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

  const fmtWon = (won: number) => `₩${won.toLocaleString()}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const balanceWon = summary ? microWonToWon(summary.balanceMicroWon) : 0
  const freePct = summary
    ? Math.min(100, Math.round((summary.freeUsedToday / Math.max(1, summary.freeLimit)) * 100))
    : 0

  return (
    <Screen safeArea padding={false} testID="wallet-screen">
      <ScreenHeader title={t('title')} mode="drawer" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {state === 'loading' && (
          <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
        )}

        {state === 'error' && (
          <Card theme={theme}>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 12 }]}>{t('error')}</Text>
            <TouchableOpacity onPress={load} style={[styles.btn, { backgroundColor: theme.colors.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>{t('retry')}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {state === 'ready' && summary && (
          <>
            {/* Balance (충전금) */}
            <Card theme={theme}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('balance.title')}</Text>
              <Text style={[styles.balance, { color: theme.colors.text }]}>{fmtWon(balanceWon)}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 4 }]}>{t('balance.hint')}</Text>
              <View style={[styles.btn, styles.btnDisabled, { backgroundColor: theme.colors.border, marginTop: 12 }]}>
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{t('balance.topUp')}</Text>
              </View>
            </Card>

            {/* Free today */}
            <Card theme={theme}>
              <View style={styles.row}>
                <Text style={[styles.title, { color: theme.colors.text }]}>{t('free.title')}</Text>
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
            </Card>

            {/* Usage history */}
            <Card theme={theme}>
              <Text style={[styles.title, { color: theme.colors.text, marginBottom: 12 }]}>{t('history.title')}</Text>
              {summary.ledger.length === 0 ? (
                <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 16 }]}>{t('history.empty')}</Text>
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
                        {positive ? '+' : '−'}{fmtWon(microWonToWon(Math.abs(e.delta)))}
                      </Text>
                    </View>
                  )
                })
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

function Card({ children, theme }: { children: React.ReactNode; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { paddingVertical: 64, alignItems: 'center' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: '600' },
  balance: { fontSize: 30, fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(128,128,128,0.2)' },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.7 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
})
