import { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  BRAIN_GAMES,
  GAME_THEMES,
  TRAINING_THEME,
  courseStatus,
  createRng,
  displayLevel,
  gameHistory,
  gameProgress,
  localDayKey,
  planTodaysSession,
  plannedMinutes,
  quickEyeMaxLevel,
  quickEyeMsAt,
  researchContent,
  todaysPlanSeed,
  weekProgress,
  type BrainGameEntry,
} from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Screen, ScreenHeader } from '../../components/ui'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { haptics } from '../../utils/haptics'
import { BrainSettingsModal } from '../../components/brain/BrainSettingsModal'
import { GradientFill } from '../../components/brain/GameCanvas'
import { WeekRing } from '../../components/brain/WeekRing'
import { Sparkline } from '../../components/brain/Sparkline'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import { gameIcon } from '../../components/brain/brain-ui'
import type { BrainStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<BrainStackParamList, 'BrainHome'>

/** Quick Eye's levels are flash times on the 33ms floor the phone uses (mobilePlatform). */
const QE_FLOOR_MS = 33

/**
 * Today's Training first — the bounded session the research counts — then every game as its own
 * card in its own colours, how it works, the research basis and the disclaimer. Progress is shown
 * as sessions this week and course steps, never as a streak or a "brain score".
 */
export function BrainHomeScreen() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('brain')
  const navigation = useNavigation<Nav>()
  const { width } = useWindowDimensions()
  useBrainHydrated()
  const progress = useBrainStore((s) => s.progress)
  const history = useBrainStore((s) => s.history)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  // The line-up that will actually play: the same seed all day, until a session is finished.
  const plan = planTodaysSession(progress, createRng(todaysPlanSeed(progress, today)))
  const minutes = plannedMinutes(plan)
  const research = researchContent(i18n.language)
  // Two cards a row on a tablet.
  const twoUp = width >= 600

  const courseChip =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : course.phase === 'core'
        ? t('training.course', { done: course.coreDone, total: course.coreTotal })
        : course.nextBoosterOn
          ? t('training.boosterNext', { date: course.nextBoosterOn })
          : null
  const courseFrac = course.phase === 'booster' && course.booster ? course.booster.done / course.booster.total : course.phase === 'core' ? course.coreDone / course.coreTotal : 1

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

        {/* Today's Training — the hero. */}
        <View style={styles.hero} {...testProps('brain-training-card', true)}>
          <GradientFill from={TRAINING_THEME.cardFrom} to={TRAINING_THEME.cardTo} />
          <View pointerEvents="none" style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <View style={styles.flex}>
              <Text style={styles.kicker} maxFontSizeMultiplier={1.4}>
                {t('training.kicker')}
              </Text>
              <Text style={styles.heroTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                {t('training.title')}
              </Text>
              <Text style={styles.heroDesc} maxFontSizeMultiplier={1.5}>
                {t('training.desc', { minutes })}
              </Text>
            </View>
            <WeekRing done={week.done} goal={week.goal} size={84} label={t('training.week', { done: week.done, goal: week.goal })} />
          </View>

          <View style={styles.lineup} accessible accessibilityLabel={`${t('training.lineup')}: ${plan.map((slot) => t(`games.${slot.gameId}.name`)).join(', ')}`}>
            {plan.map((slot, i) => (
              <View key={i} style={styles.lineupItem}>
                <View style={styles.lineupIcon}>
                  <GradientFill from={GAME_THEMES[slot.gameId].cardFrom} to={GAME_THEMES[slot.gameId].cardTo} width={44} height={44} light={0.06} />
                  <Feather name={gameIcon(slot.gameId)} size={20} color="#FFFFFF" />
                </View>
                {i < plan.length - 1 ? <View style={styles.lineupDash} /> : null}
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => {
              haptics.tap()
              navigation.navigate('BrainTraining')
            }}
            style={({ pressed }) => [styles.start, pressed && styles.pressed]}
            accessibilityRole="button"
            testID="brain-training-start"
          >
            <Feather name="play" size={22} color={TRAINING_THEME.cardTo} />
            <Text style={[styles.startText, { color: TRAINING_THEME.cardTo }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {t('training.start')}
            </Text>
          </Pressable>

          <View style={styles.heroFoot}>
            {courseChip ? (
              <View style={styles.course}>
                <Text style={styles.courseText} maxFontSizeMultiplier={1.4}>
                  {courseChip}
                </Text>
                <View style={styles.courseTrack}>
                  <View style={[styles.courseFill, { width: `${Math.max(4, Math.min(1, courseFrac) * 100)}%` }]} />
                </View>
              </View>
            ) : null}
            <View style={styles.minutes}>
              <Feather name="clock" size={15} color="rgba(255,255,255,0.85)" />
              <Text style={styles.minutesText} maxFontSizeMultiplier={1.4}>
                {progress.sessions.minutes > 0 ? t('training.minutes', { value: formatCount(progress.sessions.minutes) }) : t('training.dose')}
              </Text>
            </View>
          </View>
        </View>

        {/* Every game, in its own colours. */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]} accessibilityRole="header">
            {t('home.freePlay')}
          </Text>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('home.freePlayHint')}</Text>
        </View>

        <View style={styles.cards}>
          {BRAIN_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              twoUp={twoUp}
              levelLabel={levelLabel(game)}
              onPress={() => navigation.navigate('BrainPlay', { mode: game.id })}
              trend={gameHistory(history, game.id).map((h) => h.level)}
            />
          ))}
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
            testID="brain-research-link"
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

  function levelLabel(game: BrainGameEntry): string {
    const p = gameProgress(progress, game.id)
    if (p.rounds === 0) return t('home.new')
    if (game.id === 'quickEye') return t('home.quickEyeLevel', { stage: progress.quickEye.variant, ms: formatCount(quickEyeMsAt(p.level, QE_FLOOR_MS)) })
    return t('home.level', { level: displayLevel(p.level).toFixed(1) })
  }
}

function GameCard({ game, twoUp, levelLabel, onPress, trend }: { game: BrainGameEntry; twoUp: boolean; levelLabel: string; onPress: () => void; trend: number[] }) {
  const { t } = useTranslation('brain')
  const progress = useBrainStore((s) => s.progress)
  const theme = GAME_THEMES[game.id]
  const p = gameProgress(progress, game.id)
  const played = p.rounds > 0
  const best = progress.bestRuns[game.id]
  const icon = gameIcon(game.id)
  // How far into the current whole level (Quick Eye: down its ladder of flash times).
  const frac = game.id === 'quickEye' ? p.level / quickEyeMaxLevel(QE_FLOOR_MS) : p.level - Math.floor(p.level)
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, twoUp && styles.cardHalf, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[t(`games.${game.id}.name`), levelLabel, t(`games.${game.id}.desc`), best ? t('home.record', { value: formatCount(best) }) : null].filter(Boolean).join(', ')}
      testID={`brain-game-${game.id}`}
    >
      <GradientFill from={theme.cardFrom} to={theme.cardTo} />
      <View pointerEvents="none" style={styles.watermark}>
        <Feather name={icon} size={150} color="#FFFFFF" />
      </View>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Feather name={icon} size={24} color="#FFFFFF" />
        </View>
        <View style={[styles.chip, played ? styles.chipPlayed : styles.chipNew]}>
          {!played ? <Feather name="star" size={13} color="#0F172A" /> : null}
          <Text style={[styles.chipText, { color: played ? '#FFFFFF' : '#0F172A' }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {levelLabel}
          </Text>
        </View>
      </View>
      <View style={styles.cardMid}>
        <Text style={styles.cardName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {t(`games.${game.id}.name`)}
        </Text>
        <Text style={styles.cardDesc} numberOfLines={2} maxFontSizeMultiplier={1.4}>
          {t(`games.${game.id}.desc`)}
        </Text>
      </View>
      <View style={styles.cardFoot}>
        <View style={styles.flex}>
          {played ? (
            <View style={styles.levelTrack}>
              <View style={[styles.levelFill, { width: `${Math.max(4, Math.min(1, frac) * 100)}%` }]} />
            </View>
          ) : null}
          <View style={styles.meta}>
            <Text style={styles.metaText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {t(`skills.${game.skill}`)}
            </Text>
            {best ? (
              <>
                <Text style={styles.metaText}>·</Text>
                <Feather name="award" size={13} color="rgba(255,255,255,0.85)" />
                <Text style={[styles.metaText, styles.flexShrink]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {t('home.record', { value: formatCount(best) })}
                </Text>
              </>
            ) : null}
          </View>
        </View>
        {trend.length >= 2 ? (
          <View style={styles.spark}>
            <Sparkline values={trend} color="#FFFFFF" height={36} width={96} />
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 18 },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  gear: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  pressed: { transform: [{ scale: 0.98 }] },
  hero: { borderRadius: 26, overflow: 'hidden', padding: 20, gap: 18, boxShadow: '0 20px 40px -18px rgba(49,46,129,0.6)' },
  heroGlow: { position: 'absolute', top: -96, right: -64, width: 260, height: 260, borderRadius: 130, backgroundColor: '#A5B4FC', opacity: 0.18 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kicker: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },
  heroDesc: { color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 21, marginTop: 4 },
  lineup: { flexDirection: 'row', alignItems: 'center' },
  lineupItem: { flexDirection: 'row', alignItems: 'center' },
  lineupIcon: { width: 44, height: 44, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  lineupDash: { width: 12, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 6 },
  start: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
  },
  startText: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
  heroFoot: { gap: 12 },
  course: { gap: 6 },
  courseText: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '600' },
  courseTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  courseFill: { height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  minutes: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  minutesText: { flex: 1, color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 20 },
  sectionHead: { gap: 4 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '100%', minHeight: 176, borderRadius: 24, overflow: 'hidden', padding: 18, boxShadow: '0 12px 24px -14px rgba(0,0,0,0.5)' },
  cardHalf: { width: '48.5%' },
  watermark: { position: 'absolute', right: -24, bottom: -40, opacity: 0.14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, flexShrink: 1 },
  chipPlayed: { backgroundColor: 'rgba(255,255,255,0.2)' },
  chipNew: { backgroundColor: '#FFFFFF' },
  chipText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  cardMid: { flex: 1, marginTop: 12, gap: 2 },
  cardName: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  cardDesc: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 20 },
  cardFoot: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 12 },
  levelTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginBottom: 6 },
  levelFill: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: 'rgba(255,255,255,0.88)', fontSize: 14 },
  spark: { width: 96, opacity: 0.9 },
  research: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1 },
  researchText: { flex: 1, fontSize: 17, fontWeight: '600' },
  footer: { gap: 8, paddingTop: 4 },
  fine: { fontSize: 13, lineHeight: 19 },
})
