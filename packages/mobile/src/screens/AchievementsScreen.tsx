import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen } from '../components/ui'
import { useTheme, palette } from '../theme'
import { useGamification } from '../hooks/useGamification'
import {
  xpForLevel,
  xpInCurrentLevel,
  computeLevel,
} from '../stores/gamification-store'
import type { Achievement, NextGoal } from '../stores/gamification-store'

const CATEGORY_ORDER: Achievement['category'][] = ['streak', 'study', 'social', 'milestone']
const CATEGORY_EMOJI: Record<string, string> = {
  streak: '\uD83D\uDD25',
  study: '\uD83D\uDCD6',
  social: '\uD83E\uDD1D',
  milestone: '\uD83C\uDFC6',
}

function formatValue(category: string, value: number): string {
  if (category === 'time') {
    if (value >= 60) return `${Math.round(value / 60)}h`
    return `${value}m`
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

// ── Screen ──

export function AchievementsScreen() {
  const theme = useTheme()
  const navigation = useNavigation()

  // All data from shared Zustand store — no duplicate fetches
  const { achievements, levelInfo, goals: nextGoals, loading } = useGamification()

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const xp = levelInfo?.total_xp ?? 0
  const level = computeLevel(xp)
  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpForLevel(level)
  const progressPct = Math.min((currentLevelXp / nextLevelXp) * 100, 100)

  const earned = useMemo(() => achievements.filter(a => a.earned), [achievements])
  const recentEarned = useMemo(() =>
    [...earned].sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? '')).slice(0, 3),
    [earned],
  )

  if (loading) {
    return (
      <Screen testID="achievements-screen">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.yellow[500]} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen safeArea padding={false} testID="achievements-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Back + Title */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>{'\u2190'} Back</Text>
        </TouchableOpacity>

        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Achievements</Text>

        {/* Level + XP bar — matches web */}
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <View style={styles.levelRow}>
            <View style={[styles.levelCircle, { backgroundColor: 'rgba(234,179,8,0.15)' }]}>
              <Text style={[styles.levelNum, { color: palette.yellow[600] }]}>{level}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Level {level}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {currentLevelXp} / {nextLevelXp} XP
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[{ fontSize: 22, fontWeight: '700', color: theme.colors.text }]}>{xp.toLocaleString()}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>Total XP</Text>
            </View>
          </View>
          <View style={[styles.progressBg, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: palette.yellow[500] }]} />
          </View>
        </View>

        {/* Next Goals — matches web */}
        {nextGoals.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Next Goals</Text>
            {nextGoals.map((goal) => (
              <View key={goal.category} style={[styles.goalCard, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                <Text style={{ fontSize: 20 }}>{goal.icon || CATEGORY_EMOJI[goal.category] || '\uD83C\uDFAF'}</Text>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.goalTopRow}>
                    <Text style={[theme.typography.caption, { color: theme.colors.text, fontWeight: '500' }]}>
                      {goal.category.charAt(0).toUpperCase() + goal.category.slice(1)}
                    </Text>
                    <Text style={[{ fontSize: 11, fontWeight: '600', color: palette.blue[600] }]}>+{goal.xp} XP</Text>
                  </View>
                  <View style={[styles.progressBg, { backgroundColor: theme.colors.surface, height: 4 }]}>
                    <View style={[styles.progressFill, { width: `${Math.min(100, goal.progress)}%`, backgroundColor: palette.blue[500], height: 4 }]} />
                  </View>
                  <Text style={[{ fontSize: 11, color: theme.colors.textTertiary }]}>
                    {formatValue(goal.category, goal.current)} / {formatValue(goal.category, goal.target)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Earned — horizontal scroll */}
        {recentEarned.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Recent</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {recentEarned.map((ach) => (
                <View key={ach.id} style={[styles.recentCard, { backgroundColor: 'rgba(234,179,8,0.1)', borderColor: 'rgba(234,179,8,0.3)' }]}>
                  <Text style={{ fontSize: 28 }}>{ach.icon || '\uD83C\uDFC5'}</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.text, fontWeight: '500', textAlign: 'center' }]} numberOfLines={1}>
                    {ach.id.replace(/_/g, ' ')}
                  </Text>
                  <Text style={[{ fontSize: 10, color: theme.colors.textTertiary }]}>
                    {ach.earned_at ? new Date(ach.earned_at).toLocaleDateString() : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* All Achievements — collapsible by category */}
        <View style={styles.allSection}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            All Achievements <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{earned.length} earned</Text>
          </Text>

          {CATEGORY_ORDER.map((cat) => {
            const items = achievements.filter(a => a.category === cat)
            if (items.length === 0) return null

            const earnedInCat = items.filter(a => a.earned)
            const isExpanded = expandedCategory === cat
            const nextLocked = items.find(a => !a.earned)
            const hiddenCount = items.filter(a => !a.earned).length - (nextLocked ? 1 : 0)

            return (
              <View key={cat} style={[styles.categoryCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                <TouchableOpacity
                  onPress={() => setExpandedCategory(isExpanded ? null : cat)}
                  style={styles.categoryHeader}
                  activeOpacity={0.7}
                >
                  <View style={styles.categoryLeft}>
                    <Text style={{ fontSize: 16 }}>{CATEGORY_EMOJI[cat]}</Text>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {earnedInCat.length} earned
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.textTertiary }}>{isExpanded ? '\u25B4' : '\u25BE'}</Text>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.badgeGrid}>
                    {/* Earned badges */}
                    {earnedInCat.map((ach) => (
                      <View key={ach.id} style={[styles.badgeCard, { borderColor: 'rgba(234,179,8,0.5)', backgroundColor: theme.colors.surfaceElevated }]}>
                        <Text style={{ fontSize: 24 }}>{ach.icon || '\uD83C\uDFC5'}</Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.text, fontWeight: '500', textAlign: 'center' }]} numberOfLines={1}>
                          {ach.id.replace(/_/g, ' ')}
                        </Text>
                        <Text style={[{ fontSize: 10, color: palette.yellow[600] }]}>+{ach.xp_reward} XP</Text>
                      </View>
                    ))}

                    {/* Next locked */}
                    {nextLocked && (
                      <View style={[styles.badgeCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, opacity: 0.7 }]}>
                        <Text style={{ fontSize: 24 }}>{nextLocked.icon || '\uD83D\uDD12'}</Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]} numberOfLines={1}>
                          {nextLocked.id.replace(/_/g, ' ')}
                        </Text>
                        <Text style={[{ fontSize: 10, color: theme.colors.textTertiary }]}>{'\uD83D\uDD12'} +{nextLocked.xp_reward} XP</Text>
                      </View>
                    )}

                    {/* Hidden */}
                    {hiddenCount > 0 && (
                      <View style={[styles.badgeCard, { borderColor: theme.colors.border, borderStyle: 'dashed', backgroundColor: theme.colors.surface }]}>
                        <Text style={[{ fontSize: 20, fontWeight: '700', color: theme.colors.textTertiary }]}>???</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )
          })}
        </View>

        {/* Empty state */}
        {achievements.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 48 }}>{'\uD83C\uDFC6'}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              Start studying to earn achievements!
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn: { paddingVertical: 4 },
  // Cards
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  // Level
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  levelNum: { fontSize: 20, fontWeight: '700' },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, borderRadius: 4 },
  // Goals
  goalCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  goalTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Recent
  recentRow: { gap: 10 },
  recentCard: {
    width: 120, alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, gap: 6,
  },
  // All Achievements
  allSection: { gap: 10 },
  categoryCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 14 },
  badgeCard: {
    width: '30%' as any, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  emptyState: { alignItems: 'center', gap: 12, paddingVertical: 40 },
})
