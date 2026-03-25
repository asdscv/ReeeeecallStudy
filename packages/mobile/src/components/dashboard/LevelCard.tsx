import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import type { LevelInfo, Achievement } from '../../hooks/useGamification'

interface LevelCardProps {
  levelInfo: LevelInfo
  achievements?: Achievement[]
  onPressAchievements?: () => void
}

/**
 * Matches web AchievementsSummary — shows level, XP bar, recent badges.
 */
export function LevelCard({ levelInfo, achievements = [], onPressAchievements }: LevelCardProps) {
  const theme = useTheme()
  const { t } = useTranslation('dashboard')

  const progressPct = Math.min(
    (levelInfo.current_xp / Math.max(levelInfo.xp_for_next, 1)) * 100,
    100,
  )

  // Recent earned achievements — matches web (up to 4)
  const recentEarned = achievements
    .filter((a) => a.earned)
    .sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? ''))
    .slice(0, 4)

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <View style={styles.row}>
        <View style={[styles.circle, { backgroundColor: palette.yellow[500] }]}>
          <Text style={styles.circleText}>{levelInfo.level}</Text>
        </View>
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>
              {t('level.title', { level: levelInfo.level })}
            </Text>
            {onPressAchievements && (
              <TouchableOpacity onPress={onPressAchievements}>
                <Text style={[theme.typography.caption, { color: palette.blue[600] }]}>
                  {t('level.allAchievements')} {'>'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {levelInfo.current_xp} / {levelInfo.xp_for_next} {t('level.xpLabel')}
          </Text>
        </View>
      </View>

      {/* XP progress bar */}
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${progressPct}%`, backgroundColor: palette.yellow[500] }]} />
      </View>

      {/* Recent earned badges — matches web */}
      {recentEarned.length > 0 && (
        <View style={styles.badgeRow}>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {t('level.recent', { defaultValue: 'Recent:' })}
          </Text>
          {recentEarned.map((ach) => (
            <View key={ach.id} style={[styles.badgeCircle, { backgroundColor: ach.earned ? 'rgba(234,179,8,0.15)' : theme.colors.surface }]}>
              <Text style={{ fontSize: 14 }}>{ach.icon || '\u2B50'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  circleText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  info: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#e5e7eb', overflow: 'hidden' as const },
  barFill: { height: 6, borderRadius: 3 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  badgeCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
