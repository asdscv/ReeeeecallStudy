import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import type { CardUsageDetail } from '@reeeeecall/shared/stores/deck-store'
import { UNLIMITED_CARD_LIMIT } from './PlanSelector'

/**
 * Detailed owned-card usage panel (get_card_usage_detail, mig 137) — the mobile mirror
 * of web CardUsagePanel. Segmented bar (my cards vs subscribed), utilization %,
 * remaining, and a breakdown naming why the count differs from total cards (official
 * excluded, over-cap excess archived from study). Pure presentation; caller fetches
 * `detail`.
 */
export function CardUsagePanel({ detail }: { detail: CardUsageDetail }) {
  const theme = useTheme()
  const { t } = useTranslation('settings')
  const c = theme.colors

  const unlimited = detail.isUnlimited || detail.limit >= UNLIMITED_CARD_LIMIT
  const used = detail.usedTotal
  const limit = detail.limit
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  const ownPct = unlimited ? 0 : Math.min(100, (detail.ownedOwn / Math.max(1, limit)) * 100)
  const subPct = unlimited ? 0 : Math.min(100 - ownPct, (detail.ownedSubscribed / Math.max(1, limit)) * 100)
  const atLimit = !unlimited && detail.available <= 0
  const nearLimit = !unlimited && !atLimit && pct >= 80

  const plan = unlimited
    ? t('cardUsage.detail.planUnlimited')
    : t('cardUsage.detail.planCards', { limit: limit.toLocaleString() })

  return (
    <View>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[theme.typography.body, { fontWeight: '700',color: c.text }]} numberOfLines={1}>{plan}</Text>
          <Text style={[theme.typography.caption, { color: c.textSecondary, marginTop: 2 }]}>
            {t('cardUsage.detail.subtitle')}
          </Text>
        </View>
        {atLimit ? (
          <View style={[styles.chip, { backgroundColor: c.errorLight }]}>
            <Text style={[theme.typography.caption, { color: c.error }]}>{t('cardUsage.detail.atLimit')}</Text>
          </View>
        ) : nearLimit ? (
          <View style={[styles.chip, { backgroundColor: c.warning + '22' }]}>
            <Text style={[theme.typography.caption, { color: c.warning }]}>{t('cardUsage.detail.nearLimit')}</Text>
          </View>
        ) : null}
      </View>

      {/* Number + bar, or Unlimited hero */}
      {unlimited ? (
        <View style={[styles.unlimitedBox, { backgroundColor: c.surface }]}>
          <Text style={[theme.typography.body, { fontWeight: '700',color: c.primary }]}>∞ {t('cardUsage.detail.unlimitedTitle')}</Text>
          <Text style={[theme.typography.caption, { color: c.textSecondary, marginTop: 2 }]}>
            {t('cardUsage.detail.lifetimeTotal', { count: used })}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.numberRow}>
            <Text style={[styles.bigNumber, { color: atLimit ? c.error : c.text }]}>{used.toLocaleString()}</Text>
            <Text style={[theme.typography.caption, { color: c.textSecondary, marginLeft: 4 }]}>/ {limit.toLocaleString()}</Text>
            <Text style={[theme.typography.caption, { color: c.textSecondary, marginLeft: 'auto' }]}>
              {t('cardUsage.detail.percentUsed', { percent: pct })}
            </Text>
          </View>

          {/* Segmented bar */}
          <View
            style={[styles.track, { backgroundColor: c.border }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: limit, now: Math.min(used, limit) }}
          >
            <View style={{ width: `${ownPct}%`, height: '100%', backgroundColor: atLimit ? c.error : c.primary }} />
            <View style={{ width: `${subPct}%`, height: '100%', backgroundColor: atLimit ? c.error + '99' : c.primary + '73' }} />
          </View>

          <Text style={[theme.typography.caption, { color: atLimit ? c.error : c.textSecondary, marginTop: 8 }]}>
            {atLimit ? t('cardUsage.reached') : t('cardUsage.detail.remaining', { count: detail.available })}
          </Text>
        </>
      )}

      {/* Breakdown */}
      <View style={{ marginTop: 16, gap: 10 }}>
        <BreakdownRow dot={c.primary} label={t('cardUsage.detail.own')} value={detail.ownedOwn} color={c.text} theme={theme} />
        <BreakdownRow dot={c.primary + '73'} label={t('cardUsage.detail.subscribed')} value={detail.ownedSubscribed} color={c.text} theme={theme} />
        {detail.officialExcluded > 0 && (
          <BreakdownRow dot={c.textTertiary} label={t('cardUsage.detail.official')} note={t('cardUsage.detail.officialNote')} value={detail.officialExcluded} color={c.textSecondary} theme={theme} />
        )}
        {detail.archivedTotal > 0 && (
          <BreakdownRow dot={c.warning} label={t('cardUsage.detail.archived')} note={t('cardUsage.detail.archivedNote')} value={detail.archivedTotal} color={c.warning} theme={theme} />
        )}
      </View>
    </View>
  )
}

function BreakdownRow({
  dot, label, note, value, color, theme,
}: {
  dot: string; label: string; note?: string; value: number; color: string; theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={styles.breakRow}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[theme.typography.body, { color }]}>{label}</Text>
      {note ? <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginLeft: 6 }]}>· {note}</Text> : null}
      <Text style={[theme.typography.body, { fontWeight: '700',color, marginLeft: 'auto' }]}>{value.toLocaleString()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  unlimitedBox: { marginTop: 14, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  numberRow: { marginTop: 14, flexDirection: 'row', alignItems: 'baseline' },
  bigNumber: { fontSize: 28, fontWeight: '700' },
  track: { marginTop: 8, height: 10, borderRadius: 999, overflow: 'hidden', flexDirection: 'row', width: '100%' },
  breakRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 999, marginRight: 10 },
})
