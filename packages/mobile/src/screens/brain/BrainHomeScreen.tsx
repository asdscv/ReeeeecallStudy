import { useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  BRAIN_GAMES,
  courseStatus,
  createRng,
  displayLevel,
  gameProgress,
  localDayKey,
  planTodaysSession,
  plannedMinutes,
  researchContent,
  weekProgress,
} from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Screen, ScreenHeader } from '../../components/ui'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { haptics } from '../../utils/haptics'
import { BrainSettingsModal } from '../../components/brain/BrainSettingsModal'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import type { FeatherName } from '../../components/brain/brain-ui'
import type { BrainStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<BrainStackParamList, 'BrainHome'>

/**
 * Today's Training first — the bounded session the research counts — then free practice of any
 * single game, how it works, the research basis and the disclaimer. Progress is shown as sessions
 * this week and course steps, never as a streak or a "brain score".
 */
export function BrainHomeScreen() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('brain')
  const navigation = useNavigation<Nav>()
  useBrainHydrated()
  const progress = useBrainStore((s) => s.progress)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  // A preview of the line-up's length only; the real plan is drawn when the session starts.
  const minutes = useMemo(() => plannedMinutes(planTodaysSession(progress, createRng(1))), [progress]) || 22
  const research = researchContent(i18n.language)

  const courseChip =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : course.phase === 'core'
        ? t('training.course', { done: course.coreDone, total: course.coreTotal })
        : course.nextBoosterOn
          ? t('training.boosterNext', { date: course.nextBoosterOn })
          : null
  const weekDone = week.done >= week.goal

  const settingsButton = (
    <Pressable
      onPress={() => setSettingsOpen(true)}
      style={({ pressed }) => [styles.gear, pressed && { backgroundColor: theme.colors.surface }]}
      accessibilityRole="button"
      accessibilityLabel={t('home.settings')}
      testID="brain-settings"
    >
      <Feather name="settings" size={22} color={theme.colors.text} />
    </Pressable>
  )

  return (
    <Screen padding={false}>
      <ScreenHeader title={t('title')} mode="drawer" rightContent={settingsButton} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{t('subtitle')}</Text>

        <View style={[styles.training, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} {...testProps('brain-training-card', true)}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.trainingTitle, { color: theme.colors.text }]}>{t('training.title')}</Text>
            <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('training.desc', { minutes })}</Text>
          </View>
          <Pressable
            onPress={() => {
              haptics.tap()
              navigation.navigate('BrainTraining')
            }}
            style={({ pressed }) => [styles.start, { backgroundColor: pressed ? theme.colors.buttonPrimaryPressed : theme.colors.buttonPrimary }]}
            accessibilityRole="button"
            testID={'brain-training-start'}
          >
            <Feather name="play" size={22} color={theme.colors.primaryText} />
            <Text style={[styles.startText, { color: theme.colors.primaryText }]}>{t('training.start')}</Text>
          </Pressable>
          <View style={styles.chips}>
            <Chip
              text={weekDone ? t('training.weekDone') : t('training.week', { done: week.done, goal: week.goal })}
              icon={weekDone ? 'check-circle' : 'calendar'}
              tone={weekDone ? 'success' : 'neutral'}
            />
            {courseChip ? <Chip text={courseChip} icon="flag" tone="neutral" /> : null}
            {progress.sessions.minutes > 0 ? (
              <Chip text={t('training.minutes', { value: formatCount(progress.sessions.minutes) })} icon="clock" tone="neutral" />
            ) : null}
          </View>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('training.dose')}</Text>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]} accessibilityRole="header">
            {t('home.freePlay')}
          </Text>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('home.freePlayHint')}</Text>
        </View>

        <View style={{ gap: 10 }}>
          {BRAIN_GAMES.map((game) => {
            const p = gameProgress(progress, game.id)
            const played = p.rounds > 0
            const level = !played
              ? t('home.new')
              : game.id === 'quickEye'
                ? t('home.quickEyeLevel', { stage: progress.quickEye.variant, speed: Math.round(p.level) })
                : t('home.level', { level: displayLevel(p.level) })
            const best = progress.bestRuns[game.id]
            return (
              <Pressable
                key={game.id}
                onPress={() => navigation.navigate('BrainPlay', { mode: game.id })}
                style={({ pressed }) => [
                  styles.game,
                  { backgroundColor: theme.colors.surfaceElevated, borderColor: pressed ? theme.colors.primary : theme.colors.border },
                ]}
                accessibilityRole="button"
                testID={`brain-game-${game.id}`}
              >
                <View style={[styles.gameIcon, { backgroundColor: theme.colors.primaryLight }]}>
                  <Feather name={game.icon as FeatherName} size={24} color={theme.colors.primary} />
                </View>
                <View style={styles.gameText}>
                  <View style={styles.gameTop}>
                    <Text style={[styles.gameName, { color: theme.colors.text }]} numberOfLines={1}>
                      {t(`games.${game.id}.name`)}
                    </Text>
                    <Text style={[styles.gameLevel, { color: played ? theme.colors.textSecondary : theme.colors.primary }]}>{level}</Text>
                  </View>
                  <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t(`games.${game.id}.desc`)}</Text>
                  <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>
                    {t(`skills.${game.skill}`)}
                    {best ? ` · ${t('home.record', { value: formatCount(best) })}` : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={22} color={theme.colors.textTertiary} style={styles.chevron} />
              </Pressable>
            )
          })}
        </View>

        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('home.howItWorks')}</Text>

        {research ? (
          <Pressable
            onPress={() => navigation.navigate('BrainResearch')}
            style={({ pressed }) => [
              styles.research,
              { backgroundColor: theme.colors.surfaceElevated, borderColor: pressed ? theme.colors.primary : theme.colors.border },
            ]}
            accessibilityRole="button"
            testID={'brain-research-link'}
          >
            <Feather name="book-open" size={22} color={theme.colors.primary} />
            <Text style={[styles.researchText, { color: theme.colors.text }]}>{t('home.research')}</Text>
            <Feather name="chevron-right" size={22} color={theme.colors.textTertiary} />
          </Pressable>
        ) : null}

        <View style={styles.footer}>
          <Text style={[styles.fine, { color: theme.colors.textSecondary }]}>{t('disclaimer')}</Text>
          <Text style={[styles.fine, { color: theme.colors.textSecondary }]}>{t('worry')}</Text>
        </View>
      </ScrollView>

      <BrainSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Screen>
  )
}

function Chip({ text, icon, tone }: { text: string; icon: FeatherName; tone: 'success' | 'neutral' }) {
  const theme = useTheme()
  const success = tone === 'success'
  return (
    <View style={[styles.chip, { backgroundColor: success ? theme.colors.successLight : theme.colors.surface }]}>
      <Feather name={icon} size={15} color={success ? theme.colors.success : theme.colors.textSecondary} />
      <Text style={[styles.chipText, { color: success ? theme.colors.success : theme.colors.text }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 18 },
  gear: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  training: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  trainingTitle: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  start: {
    minHeight: 60,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  startText: { fontSize: 18, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  chipText: { fontSize: 15, fontWeight: '500' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  game: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 72, borderRadius: 14, borderWidth: 1 },
  gameIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  gameText: { flex: 1, gap: 3 },
  gameTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  gameName: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  gameLevel: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 15 },
  chevron: { marginLeft: -4 },
  research: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1 },
  researchText: { flex: 1, fontSize: 17, fontWeight: '600' },
  footer: { gap: 8, paddingTop: 4 },
  fine: { fontSize: 13, lineHeight: 19 },
})
