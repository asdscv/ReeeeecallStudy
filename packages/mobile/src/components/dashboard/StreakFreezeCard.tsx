import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import type { FreezeInfo } from '../../hooks/useGamification'

interface StreakFreezeCardProps {
  freezeInfo: FreezeInfo
  totalXp?: number
}

/**
 * Matches web StreakFreezeWidget — shows freeze icons, total XP, motivational message.
 */
export function StreakFreezeCard({ freezeInfo, totalXp }: StreakFreezeCardProps) {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {t('streakFreeze.title')}
        </Text>
        {totalXp != null && totalXp > 0 && (
          <Text style={[styles.xpText, { color: palette.yellow[600] }]}>
            +{totalXp.toLocaleString()} XP
          </Text>
        )}
      </View>
      <View style={styles.iconsRow}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Text key={i} style={styles.icon}>
            {i < freezeInfo.streak_freezes ? '\uD83D\uDEE1\uFE0F' : '\u25CB'}
          </Text>
        ))}
      </View>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
        {t('streakFreeze.available', { count: freezeInfo.streak_freezes })}
      </Text>
      {/* Motivational message — matches web */}
      {totalXp != null && totalXp > 0 && (
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
          {t('streakFreeze.motivational', { defaultValue: '\uD83D\uDCAA Keep going! You\'re doing great!' })}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  xpText: { fontSize: 14, fontWeight: '700' },
  iconsRow: { flexDirection: 'row', gap: 10 },
  icon: { fontSize: 20 },
})
