import { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  ACHIEVEMENTS,
  BRAIN_GAMES,
  GAME_THEMES,
  SESSION_MINUTES,
  TRAINING_THEME,
  courseStatus,
  createRng,
  displayLevel,
  gameHistory,
  gameProgress,
  hasAchievement,
  localDayKey,
  planToday,
  plannedMinutes,
  todaysPlanSeed,
  weekProgress,
  type AchievementId,
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
import { FX, gameIcon } from '../../components/brain/brain-ui'
import { ACHIEVEMENT_ICONS, TierBar, TierMedal, tierA11y, tierName, tierStanding } from '../../components/brain/tier-ui'
import type { BrainStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<BrainStackParamList, 'BrainHome'>

/**
 * Today's Training first — the bounded session the research counts — then every game as its own
 * card in its own colours, how it works and a short disclaimer. Progress is shown
 * as sessions this week and course steps, never as a streak or a "brain score".
 */
export function BrainHomeScreen() {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const navigation = useNavigation<Nav>()
  const { width } = useWindowDimensions()
  useBrainHydrated()
  const progress = useBrainStore((s) => s.progress)
  const history = useBrainStore((s) => s.history)
  const meta = useBrainStore((s) => s.meta)
  const setSettings = useBrainStore((s) => s.setSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  // The line-up that will actually play: the same seed all day, until a session is finished.
  const { focus, slots: plan } = planToday(progress, createRng(todaysPlanSeed(progress, today)))
  const minutes = plannedMinutes(plan)
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
                {t('training.desc', { minutes, count: plan.length })}
              </Text>
              <Text style={styles.heroFocus} maxFontSizeMultiplier={1.4} testID="brain-training-focus">
                {t(`training.focus.${focus}`)}
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

          {/* Session length: a quick 5 minutes or the full 20 — remembered on this device. */}
          <View style={styles.lengthRow}>
            <Text style={styles.lengthLabel} maxFontSizeMultiplier={1.4}>
              {t('training.length')}
            </Text>
            <View style={styles.lengthGroup} accessibilityRole="radiogroup" accessibilityLabel={t('training.length')}>
              {SESSION_MINUTES.map((m) => {
                const on = progress.settings.sessionMinutes === m
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      haptics.tap()
                      setSettings({ sessionMinutes: m })
                    }}
                    style={[styles.lengthOption, on && styles.lengthOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    testID={`brain-session-${m}`}
                  >
                    <Text style={[styles.lengthText, { color: on ? TRAINING_THEME.cardTo : '#FFFFFF' }]} maxFontSizeMultiplier={1.3}>
                      {t('training.minutesShort', { value: m })}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
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

        {/* Achievements: every one listed, earned ones in colour — never a count or a total. */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]} accessibilityRole="header">
            {t('achievements.title')}
          </Text>
        </View>
        <View style={styles.achGrid} testID="brain-achievements">
          {ACHIEVEMENTS.map((id) => (
            <AchievementTile key={id} id={id} earned={hasAchievement(meta, id)} columns={width >= 600 ? 3 : 2} />
          ))}
        </View>

        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t('home.howItWorks')}</Text>

        <View style={styles.footer}>
          <Text style={[styles.fine, { color: theme.colors.textSecondary }]}>{t('disclaimer')}</Text>
          <Text style={[styles.fine, { color: theme.colors.textSecondary }]}>{t('worry')}</Text>
        </View>
      </ScrollView>

      <BrainSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Screen>
  )

  /** The level, small: "Lv. 7.3". */
  function levelLabel(game: BrainGameEntry): string {
    const p = gameProgress(progress, game.id)
    // A placement left part-way (n = 0) has no level yet — never its interim probe level.
    if (p.rounds === 0 || meta.sk[game.id]?.n === 0) return t('home.new')
    return t('home.level', { level: displayLevel(p.level).toFixed(1) })
  }
}

/**
 * One achievement on the hub. Earned: in colour with its title and line. Not yet: dimmed, with
 * "not yet" — the line still says what it takes, so nothing is a mystery box.
 */
function AchievementTile({ id, earned, columns }: { id: AchievementId; earned: boolean; columns: number }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const title = t(`achievements.${id}.title`)
  const body = t(`achievements.${id}.body`)
  const width = columns === 3 ? '31.8%' : '48.4%'
  return (
    <View
      style={[styles.ach, { width }, earned ? styles.achEarned : { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      accessible
      accessibilityLabel={`${title}, ${earned ? t('achievements.earned') : t('achievements.locked')}. ${body}`}
      testID={`brain-achievement-${id}`}
    >
      {earned ? <GradientFill from={TRAINING_THEME.cardFrom} to={TRAINING_THEME.cardTo} light={0.05} /> : null}
      <View style={styles.achTop}>
        <View style={[styles.achIcon, earned ? styles.achIconEarned : { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
          <Feather name={earned ? ACHIEVEMENT_ICONS[id] : 'lock'} size={18} color={earned ? '#0F172A' : theme.colors.textTertiary} />
        </View>
        {earned ? null : (
          <Text style={[styles.achLocked, { color: theme.colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {t('achievements.locked')}
          </Text>
        )}
      </View>
      <Text style={[styles.achTitle, { color: earned ? '#FFFFFF' : theme.colors.textSecondary }]} maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      {/* Dimmed by colour and the lock, not by fading the text: the line stays readable. */}
      <Text style={[styles.achBody, { color: earned ? 'rgba(255,255,255,0.88)' : theme.colors.textSecondary }]} maxFontSizeMultiplier={1.4}>
        {body}
      </Text>
    </View>
  )
}

function GameCard({ game, twoUp, levelLabel, onPress, trend }: { game: BrainGameEntry; twoUp: boolean; levelLabel: string; onPress: () => void; trend: number[] }) {
  const { t } = useTranslation('brain')
  const progress = useBrainStore((s) => s.progress)
  const meta = useBrainStore((s) => s.meta)
  const theme = GAME_THEMES[game.id]
  const p = gameProgress(progress, game.id)
  const played = p.rounds > 0
  const best = progress.bestRuns[game.id]
  const icon = gameIcon(game.id)
  // This game's tier and the way to the next — per game only, never added up across games.
  const standing = tierStanding(game.id, meta, progress)
  // A placement left part-way (n = 0) has no level yet: shown like a game never played — "new",
  // no level and no tier bar — never its interim probe level. A tier earned stays.
  const placing = meta.sk[game.id]?.n === 0
  const fresh = !played || (placing && standing.tier === 0)
  const showLevel = played && !placing
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, twoUp && styles.cardHalf, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[
        t(`games.${game.id}.name`),
        fresh ? t('home.new') : `${t('tiers.label')} ${tierA11y(t, standing)}`,
        showLevel ? levelLabel : null,
        t(`games.${game.id}.desc`),
        best ? t('home.record', { value: formatCount(best) }) : null,
      ]
        .filter(Boolean)
        .join(', ')}
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
        {!fresh ? (
          <View style={[styles.chip, styles.chipPlayed]} testID={`brain-game-${game.id}-tier`}>
            <TierMedal tier={standing.tier} size={20} />
            <Text style={[styles.chipText, { color: '#FFFFFF' }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {tierName(t, standing.tier)}
            </Text>
          </View>
        ) : (
          <View style={[styles.chip, styles.chipNew]}>
            <Feather name="star" size={13} color="#0F172A" />
            <Text style={[styles.chipText, { color: '#0F172A' }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {t('home.new')}
            </Text>
          </View>
        )}
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
          {!fresh ? (
            <View style={styles.levelTrack}>
              <TierBar frac={standing.frac} color={standing.next === null ? FX.gold : '#FFFFFF'} track="rgba(255,255,255,0.25)" height={6} />
            </View>
          ) : null}
          <View style={styles.meta}>
            {showLevel ? (
              <>
                <Text style={[styles.metaText, styles.metaLevel]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {levelLabel}
                </Text>
                <Text style={styles.metaText}>·</Text>
              </>
            ) : null}
            <Text style={[styles.metaText, styles.flexShrink]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
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
  heroFocus: { marginTop: 4, color: 'rgba(255,255,255,0.78)', fontSize: 14, fontWeight: '700' },
  lengthRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  lengthLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  lengthGroup: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)' },
  lengthOption: { minHeight: 44, minWidth: 76, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lengthOn: { backgroundColor: '#FFFFFF' },
  lengthText: { fontSize: 16, fontWeight: '800' },
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
  levelTrack: { marginBottom: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { color: 'rgba(255,255,255,0.88)', fontSize: 14 },
  metaLevel: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  achGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ach: { borderRadius: 18, borderWidth: 1, overflow: 'hidden', padding: 14, gap: 6 },
  achEarned: { borderColor: 'transparent', boxShadow: '0 10px 20px -12px rgba(49,46,129,0.6)' },
  achTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 2 },
  achIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  achIconEarned: { backgroundColor: FX.gold, borderColor: 'rgba(255,255,255,0.6)' },
  achLocked: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  achTitle: { fontSize: 15, fontWeight: '800' },
  achBody: { fontSize: 13, lineHeight: 18 },
  spark: { width: 96, opacity: 0.9 },
  footer: { gap: 8, paddingTop: 4 },
  fine: { fontSize: 13, lineHeight: 19 },
})
