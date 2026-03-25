import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import type { Quest } from '../../hooks/useGamification'

interface DailyQuestsCardProps {
  quests: Quest[]
}

export function DailyQuestsCard({ quests }: DailyQuestsCardProps) {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')

  if (quests.length === 0) return null

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {t('quests.title')}
      </Text>
      {quests.map((q, i) => {
        const pct = Math.min((q.current_value / Math.max(q.target_value, 1)) * 100, 100)
        const label = t(`quests.${q.quest_type}`, { count: q.target_value })

        return (
          <View
            key={i}
            style={[
              styles.item,
              { backgroundColor: q.completed ? palette.green[50] : theme.colors.background },
            ]}
          >
            <View style={styles.topRow}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text, flex: 1 }]}>
                {q.completed ? `${t('quests.completed', { defaultValue: label })}` : label}
              </Text>
              <View style={[styles.xpBadge, { backgroundColor: q.completed ? palette.green[100] : palette.blue[50] }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: q.completed ? palette.green[700] : palette.blue[700] }}>
                  +{q.current_xp ?? 30} XP
                </Text>
              </View>
            </View>
            <View style={styles.barBg}>
              <View
                style={[
                  styles.barFill,
                  { width: `${pct}%`, backgroundColor: q.completed ? palette.green[500] : palette.blue[500] },
                ]}
              />
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {q.current_value} / {q.target_value}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  item: { gap: 4, borderRadius: 10, padding: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  xpBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' as const },
  barFill: { height: 6, borderRadius: 3 },
})
