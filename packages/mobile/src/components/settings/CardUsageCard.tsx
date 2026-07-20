import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import {
  useDeckStore,
  registerCardUsageDetailInterest,
  releaseCardUsageDetailInterest,
} from '@reeeeecall/shared/stores/deck-store'
import { UNLIMITED_CARD_LIMIT } from './PlanSelector'
import { CardUsageModal } from './CardUsageModal'

/**
 * Compact card-storage widget for the mobile Dashboard — at-a-glance meter that opens
 * the full CardUsageModal on tap. Mirror of web CardUsageCard. Renders nothing until
 * usage is known.
 */
export function CardUsageCard() {
  const theme = useTheme()
  const { t } = useTranslation('settings')
  const c = theme.colors
  const detail = useDeckStore((s) => s.cardUsageDetail)
  const fetchDetail = useDeckStore((s) => s.fetchCardUsageDetail)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    registerCardUsageDetailInterest()
    void fetchDetail()
    return () => releaseCardUsageDetailInterest()
  }, [fetchDetail])

  // Skeleton (fixed-height placeholder) while loading → no layout shift on pop-in.
  // Tappable so a transient first-fetch failure can't strand a permanent skeleton.
  if (!detail) {
    return (
      <TouchableOpacity
        testID="dashboard-card-usage-skeleton"
        activeOpacity={0.7}
        onPress={() => void fetchDetail({ force: true })}
        style={[styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border, height: 96 }]}
      />
    )
  }

  const unlimited = detail.isUnlimited || detail.limit >= UNLIMITED_CARD_LIMIT
  const pct = unlimited ? 0 : Math.min(100, Math.round((detail.usedTotal / Math.max(1, detail.limit)) * 100))
  const atLimit = !unlimited && detail.available <= 0
  const nearLimit = !unlimited && !atLimit && pct >= 80
  const barColor = atLimit ? c.error : nearLimit ? c.warning : c.primary

  return (
    <>
      <TouchableOpacity
        testID="dashboard-card-usage"
        activeOpacity={0.7}
        onPress={() => setOpen(true)}
        style={[styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
      >
        <View style={styles.topRow}>
          <Text style={{ fontSize: 15 }}>📇</Text>
          <Text style={[theme.typography.label, { color: c.text }]}>{t('cardUsage.detail.title')}</Text>
          {atLimit && (
            <View style={[styles.chip, { backgroundColor: c.errorLight }]}>
              <Text style={[theme.typography.caption, { color: c.error }]}>{t('cardUsage.detail.atLimit')}</Text>
            </View>
          )}
          {nearLimit && (
            <View style={[styles.chip, { backgroundColor: c.warning + '22' }]}>
              <Text style={[theme.typography.caption, { color: c.warning }]}>{t('cardUsage.detail.nearLimit')}</Text>
            </View>
          )}
          <Text style={{ color: c.textTertiary, marginLeft: 'auto', fontSize: 18 }}>›</Text>
        </View>

        <View style={styles.numRow}>
          <Text style={[styles.big, { color: atLimit ? c.error : c.text }]}>{detail.usedTotal.toLocaleString()}</Text>
          <Text style={[theme.typography.caption, { color: c.textSecondary, marginLeft: 4 }]}>
            {unlimited ? t('cardUsage.detail.planUnlimited') : `/ ${detail.limit.toLocaleString()}`}
          </Text>
        </View>

        {!unlimited && (
          <View style={[styles.track, { backgroundColor: c.border }]}>
            <View style={{ width: `${pct}%`, height: '100%', backgroundColor: barColor, borderRadius: 999 }} />
          </View>
        )}

        {detail.archivedTotal > 0 && (
          <Text style={[theme.typography.caption, { color: c.warning, marginTop: 6 }]}>
            📦 {t('cardUsage.detail.archivedCount', { count: detail.archivedTotal })}
          </Text>
        )}
      </TouchableOpacity>

      <CardUsageModal visible={open} onClose={() => setOpen(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginLeft: 2 },
  numRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 12 },
  big: { fontSize: 24, fontWeight: '700' },
  track: { marginTop: 8, height: 6, borderRadius: 999, overflow: 'hidden', width: '100%' },
})
