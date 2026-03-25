import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import type { NextGoal } from '../../hooks/useGamification'

interface NextGoalsCardProps {
  goals: NextGoal[]
}

export function NextGoalsCard({ goals }: NextGoalsCardProps) {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')

  if (goals.length === 0) return null

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {t('goals.title')}
      </Text>
      {goals.map((g, i) => {
        const label = g.label || g.category.charAt(0).toUpperCase() + g.category.slice(1)
        const pct = Math.min(g.progress ?? 0, 100)

        return (
          <View key={i} style={styles.item}>
            <View style={styles.topRow}>
              <Text style={{ fontSize: 16 }}>{g.icon}</Text>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text, flex: 1 }]}>
                {label}
              </Text>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {g.current} / {g.target}
              </Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: palette.blue[500] }]} />
            </View>
            <View style={styles.bottomRow}>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {pct}%
              </Text>
              <View style={[styles.xpBadge, { backgroundColor: palette.blue[50] }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.blue[700] }}>
                  +{g.xp} XP
                </Text>
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  item: { gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  xpBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' as const },
  barFill: { height: 6, borderRadius: 3 },
})
