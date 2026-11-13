import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, BackHandler } from 'react-native'
import Animated from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  GAME_THEMES,
  TIER_COUNT,
  TRAINING_THEME,
  courseStatus,
  displayLevel,
  localDayKey,
  weekProgress,
  type AchievementId,
  type BrainGameId,
  type PlanSlot,
} from '@reeeeecall/shared/lib/brain-games'
import { useTodaysTraining, type TrainingTotals } from '@reeeeecall/shared/hooks/useTodaysTraining'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { RoundView } from '../../components/brain/RoundView'
import { GameIntro } from '../../components/brain/GameIntro'
import { CanvasButton, CanvasSheet, Confetti, GameCanvas, GradientFill, StatTile } from '../../components/brain/GameCanvas'
import { WeekRing } from '../../components/brain/WeekRing'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import { celebrateHaptic } from '../../components/brain/fx-haptics'
import { useMotion } from '../../components/brain/motion'
import { FX, flushBrainStorage, gameIcon } from '../../components/brain/brain-ui'
import { AchievementCard, TIER_COLORS, TierMedal, qeSpeedLevel, tierName } from '../../components/brain/tier-ui'

/**
 * Today's Training: the line-up, then each game's intro (with the session's steps), its rounds,
 * the next game's intro, and the session's end. The session plans its line-up from the player's
 * progress, so it waits until that is loaded.
 */
export function BrainTrainingScreen() {
  useTranslation('brain')
  const ready = useBrainHydrated()
  useEffect(() => () => flushBrainStorage(), [])
  return ready ? <Training /> : <GameCanvas theme={TRAINING_THEME}>{null}</GameCanvas>
}

function Training() {
  const { t } = useTranslation('brain')
  const navigation = useNavigation()
  const s = useTodaysTraining()
  const [stage, setStage] = useState<'lineup' | 'intro' | 'play'>('lineup')
  const [askingStop, setAskingStop] = useState(false)
  const { onRoundOver, continueSession } = s
  const gameId = s.slot.gameId
  // What the session's rounds earned on the way — told once, at the session's end (no results
  // screen between rounds here).
  const [earned, setEarned] = useState<{ achievements: AchievementId[]; tierUps: Partial<Record<BrainGameId, number>> }>({ achievements: [], tierUps: {} })
  // Placement per game: the level its climb started from once placement found it, or null while a
  // placement stopped part-way has no level to show yet. Games that never placed are not listed.
  const [placed, setPlaced] = useState<PlacedLevels>({})
  // No summary between rounds: the session moves on by itself, and the end screen sums it up.
  const onOver = useCallback(
    (stats: RoundStats) => {
      if (stats.achievements.length || stats.tierUp) {
        setEarned((e) => ({
          achievements: [...e.achievements, ...stats.achievements.filter((a) => !e.achievements.includes(a))],
          tierUps: stats.tierUp ? { ...e.tierUps, [gameId]: Math.max(stats.tierUp, e.tierUps[gameId] ?? 0) } : e.tierUps,
        }))
      }
      if (stats.placement !== 'none') setPlaced((p) => ({ ...p, [gameId]: stats.placement === 'done' ? stats.levelStart : null }))
      onRoundOver(gameId, stats)
    },
    [onRoundOver, gameId],
  )
  const games = s.slots.map((slot) => slot.gameId)
  const stepsLabel = t('training.title')
  const leave = useCallback(() => navigation.goBack(), [navigation])

  // On an intro mid-session, Android's back button asks first (a second press keeps playing) — a
  // stop there leaves the session uncounted. The line-up and the end screen just leave; a round
  // handles the button itself.
  const guarded = (s.phase === 'playing' && stage === 'intro') || s.phase === 'between'
  useEffect(() => {
    if (!guarded) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setAskingStop((asking) => !asking)
      return true
    })
    return () => sub.remove()
  }, [guarded])

  const stopSheet = askingStop ? (
    <CanvasSheet
      theme={GAME_THEMES[s.next?.gameId ?? gameId]}
      testID="brain-training-stop-sheet"
      title={t('play.stopTitle')}
      body={t('training.stopBody')}
      keepLabel={t('play.keepPlaying')}
      onKeep={() => setAskingStop(false)}
      stopLabel={t('play.stopNow')}
      onStop={leave}
      stopTestID="brain-training-stop"
    />
  ) : null

  if (s.phase === 'playing' && stage === 'lineup') {
    return <Lineup slots={s.slots} minutes={s.plannedMinutes} onStart={() => setStage('intro')} onClose={leave} />
  }
  if (s.phase === 'playing' && stage === 'intro') {
    return (
      <GameIntro
        gameId={gameId}
        onStart={() => setStage('play')}
        onClose={() => setAskingStop(true)}
        closeLabel={t('play.stop')}
        steps={{ games, index: s.slotIndex, label: stepsLabel }}
        overlay={stopSheet}
      />
    )
  }
  if (s.phase === 'playing') {
    return (
      <RoundView
        key={s.roundKey}
        gameId={gameId}
        caption={`${t('training.title')} · ${t('training.slot', { index: s.slotIndex + 1, total: s.slots.length })}`}
        onOver={onOver}
        confirmEmpty
        stopBody={t('training.stopBody')}
      />
    )
  }
  if (s.phase === 'between' && s.next) {
    return (
      <GameIntro
        gameId={s.next.gameId}
        onStart={() => {
          continueSession()
          setStage('play')
        }}
        onClose={() => setAskingStop(true)}
        closeLabel={t('play.stop')}
        steps={{ games, index: s.slotIndex + 1, label: stepsLabel }}
        overlay={stopSheet}
      />
    )
  }
  const achievements = [...earned.achievements, ...s.achievements.filter((a) => !earned.achievements.includes(a))]
  return (
    <SessionEnd
      done={s.phase === 'done'}
      totals={s.totals}
      activeMinutes={s.activeMinutes}
      achievements={achievements}
      tierUps={earned.tierUps}
      placed={placed}
      onHome={leave}
    />
  )
}

/** Per game: where its climb started once placement found it, or null while placement is unfinished. */
type PlacedLevels = Partial<Record<BrainGameId, number | null>>

/** The session's line-up before it starts: four games, about how long, one start. */
function Lineup({ slots, minutes, onStart, onClose }: { slots: PlanSlot[]; minutes: number; onStart: () => void; onClose: () => void }) {
  const { t } = useTranslation('brain')
  const progress = useBrainStore((st) => st.progress)
  const week = weekProgress(progress, localDayKey())
  const rise = useMotion('rise', 'lineup')
  return (
    <GameCanvas theme={TRAINING_THEME} testID="brain-training-lineup">
      <View style={styles.root}>
        <View style={styles.header}>
          <CanvasButton variant="chip" icon="x" label={t('play.back')} onPress={onClose} theme={TRAINING_THEME} testID="brain-training-back" />
        </View>
        <ScrollView contentContainerStyle={styles.lineupContent} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.lineupHero, rise]}>
            <View style={styles.flex}>
              <Text style={styles.h1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                {t('training.title')}
              </Text>
              <Text style={styles.lead} maxFontSizeMultiplier={1.5}>
                {t('training.desc', { minutes })}
              </Text>
            </View>
            <WeekRing done={week.done} goal={week.goal} label={t('training.week', { done: week.done, goal: week.goal })} color={TRAINING_THEME.accent} />
          </Animated.View>
          <View style={styles.list} accessibilityLabel={t('training.lineup')}>
            {slots.map((slot, i) => (
              <LineupRow key={i} index={i} slot={slot} />
            ))}
          </View>
          <Text style={styles.dose} maxFontSizeMultiplier={1.5}>
            {t('training.dose')}
          </Text>
        </ScrollView>
        <View style={styles.bottomBar}>
          <CanvasButton icon="play" label={t('training.start')} onPress={onStart} theme={TRAINING_THEME} testID="brain-training-begin" />
        </View>
      </View>
    </GameCanvas>
  )
}

function LineupRow({ index, slot }: { index: number; slot: PlanSlot }) {
  const { t } = useTranslation('brain')
  const rise = useMotion('rise', slot.gameId, index * 70)
  const theme = GAME_THEMES[slot.gameId]
  return (
    <Animated.View style={[styles.row, rise]} accessible accessibilityLabel={`${index + 1}. ${t(`games.${slot.gameId}.name`)}, ${t('training.minutesShort', { value: slot.minutes })}`}>
      <Text style={styles.rowIndex} maxFontSizeMultiplier={1.3}>
        {index + 1}
      </Text>
      <View style={styles.rowIcon}>
        <GradientFill from={theme.cardFrom} to={theme.cardTo} width={56} height={56} light={0.06} />
        <Feather name={gameIcon(slot.gameId)} size={26} color="#FFFFFF" />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {t(`games.${slot.gameId}.name`)}
        </Text>
        <Text style={styles.rowDesc} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {t(`games.${slot.gameId}.desc`)}
        </Text>
      </View>
      <View style={styles.rowTime}>
        <Feather name="clock" size={15} color="rgba(255,255,255,0.75)" />
        <Text style={styles.rowTimeText} maxFontSizeMultiplier={1.3}>
          {t('training.minutesShort', { value: slot.minutes })}
        </Text>
      </View>
    </Animated.View>
  )
}

/**
 * Session complete (or stopped): the week ring fills, the course moves, what the session earned,
 * each game's change.
 */
function SessionEnd({
  done,
  totals,
  activeMinutes,
  achievements,
  tierUps,
  placed,
  onHome,
}: {
  done: boolean
  totals: TrainingTotals
  activeMinutes: number
  /** Earned in the session's rounds, then by finishing it (those arrive a moment after the screen opens). */
  achievements: AchievementId[]
  /** The highest tier each game reached during the session. */
  tierUps: Partial<Record<BrainGameId, number>>
  placed: PlacedLevels
  onHome: () => void
}) {
  const { t } = useTranslation('brain')
  // Read after the session was recorded, so the week and the course already include it.
  const progress = useBrainStore((st) => st.progress)
  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const accuracy = totals.trials > 0 ? Math.round((totals.correct / totals.trials) * 100) : 0
  const minutes = Math.max(1, Math.round(activeMinutes))
  const levels = Object.entries(totals.levels) as [BrainGameId, { start: number; end: number }][]
  const titleIn = useMotion('rise', done)
  useEffect(() => {
    if (done) celebrateHaptic()
  }, [done])
  const courseLabel =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : t('training.course', { done: course.coreDone, total: course.coreTotal })
  const courseFrac = course.phase === 'booster' && course.booster ? course.booster.done / course.booster.total : course.coreDone / course.coreTotal

  return (
    <GameCanvas theme={TRAINING_THEME} testID="brain-training-card">
      <ScrollView contentContainerStyle={styles.endContent} showsVerticalScrollIndicator={false}>
        <View style={styles.endHead}>
          {done ? <WeekRing done={week.done} goal={week.goal} size={132} label={t('training.week', { done: week.done, goal: week.goal })} color={FX.gold} /> : null}
          <Animated.Text style={[styles.h1, styles.centerText, titleIn]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            {done ? t('training.doneTitle') : t('training.quitTitle')}
          </Animated.Text>
          <Text style={[styles.lead, styles.centerText]} maxFontSizeMultiplier={1.5}>
            {done ? (week.done >= week.goal ? t('training.weekDone') : t('training.doneBody')) : t('training.quitBody')}
          </Text>
        </View>

        {done ? (
          <View style={styles.card} accessible accessibilityLabel={courseLabel}>
            <Text style={styles.courseLabel} maxFontSizeMultiplier={1.4}>
              {courseLabel}
            </Text>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.max(4, Math.min(1, courseFrac) * 100)}%` }]} />
            </View>
          </View>
        ) : null}

        {achievements.length > 0 ? (
          <View style={styles.list} testID="brain-training-achievements">
            {achievements.map((id, i) => (
              <AchievementCard key={id} id={id} delay={250 + i * 160} />
            ))}
          </View>
        ) : null}

        <View style={styles.stats}>
          <StatTile icon="clock" label={t('summary.minutes')} value={formatCount(minutes)} center />
          <StatTile icon="list" label={t('summary.trials')} value={formatCount(totals.trials)} center />
          <StatTile icon="target" label={t('summary.accuracy')} value={`${formatCount(accuracy)}%`} center />
        </View>

        {levels.length > 0 ? (
          <View style={styles.list}>
            {levels.map(([id, l]) => {
              // A placement stopped part-way has no level yet (its probe levels are not progress):
              // no change is shown. A finished one counts from where the climb started.
              const start = placed[id]
              const showLevel = start !== null
              // Quick Eye: its speed level 0-11 (higher is better) — never a flash time.
              const qe = id === 'quickEye'
              const startLevel = start ?? l.start
              const from = qe ? qeSpeedLevel(startLevel) : displayLevel(startLevel)
              const to = qe ? qeSpeedLevel(l.end) : displayLevel(l.end)
              const better = to > from
              const fmt = (v: number) => (qe ? formatCount(v) : v.toFixed(1))
              const theme = GAME_THEMES[id]
              const change = qe ? `${t('quickEye.speedLevel', { level: from })} → ${formatCount(to)}` : `${fmt(from)} → ${fmt(to)}`
              const tierUp = tierUps[id]
              const tierUpText = tierUp ? t('tiers.up', { tier: tierName(t, tierUp) }) : null
              const changeColor = better ? FX.goodText : 'rgba(255,255,255,0.8)'
              return (
                <View
                  key={id}
                  style={styles.row}
                  accessible
                  accessibilityLabel={[t(`games.${id}.name`), tierUpText, showLevel ? change : null].filter(Boolean).join(', ')}
                >
                  <View style={[styles.rowIcon, styles.rowIconSmall]}>
                    <GradientFill from={theme.cardFrom} to={theme.cardTo} width={44} height={44} light={0.06} />
                    <Feather name={gameIcon(id)} size={20} color="#FFFFFF" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                      {t(`games.${id}.name`)}
                    </Text>
                    {/* A tier reached during the session — said here, since rounds in a session have no results screen. */}
                    {tierUp && tierUpText ? (
                      <View style={styles.tierUp} testID={`brain-training-tier-up-${id}`}>
                        <TierMedal tier={tierUp} size={18} />
                        <Text style={[styles.tierUpText, { color: TIER_COLORS[Math.min(TIER_COUNT, tierUp)] }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                          {tierUpText}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {showLevel ? (
                    <View style={styles.change}>
                      {/* Quick Eye's numbers are its speed level, so say so once. */}
                      {qe ? (
                        <Text style={styles.changeUnit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                          {t('intro.speed')}
                        </Text>
                      ) : null}
                      <Text style={[styles.changeText, { color: changeColor }]} maxFontSizeMultiplier={1.3}>
                        {fmt(from)}
                      </Text>
                      <Feather name="arrow-right" size={15} color={changeColor} />
                      <Text style={[styles.changeText, { color: changeColor }]} maxFontSizeMultiplier={1.3}>
                        {fmt(to)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        ) : null}

        <CanvasButton icon="home" label={t('training.backHome')} onPress={onHome} theme={TRAINING_THEME} testID="brain-training-home" />
      </ScrollView>
      {done ? <Confetti colors={[FX.gold, '#A5B4FC', '#FFFFFF', '#F0ABFC', FX.goodText]} /> : null}
    </GameCanvas>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  centerText: { textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, minHeight: 56 },
  lineupContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 24 },
  lineupHero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  h1: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  lead: { color: 'rgba(255,255,255,0.82)', fontSize: 17, lineHeight: 25, marginTop: 6 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: FX.glass, borderWidth: 1, borderColor: FX.glassBorder },
  rowIndex: { width: 22, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rowIcon: { width: 56, height: 56, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowIconSmall: { width: 44, height: 44, borderRadius: 12 },
  rowName: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  rowDesc: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 2 },
  rowTime: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowTimeText: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  dose: { color: 'rgba(255,255,255,0.75)', fontSize: 16, lineHeight: 23 },
  bottomBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  endContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 18, width: '100%', maxWidth: 480, alignSelf: 'center' },
  endHead: { alignItems: 'center', gap: 12 },
  card: { borderRadius: 18, backgroundColor: FX.glass, borderWidth: 1, borderColor: FX.glassBorder, padding: 16, gap: 12 },
  courseLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  track: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  trackFill: { height: 10, borderRadius: 5, backgroundColor: TRAINING_THEME.accent },
  stats: { flexDirection: 'row', gap: 8 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changeText: { fontSize: 16, fontVariant: ['tabular-nums'] },
  changeUnit: { color: 'rgba(255,255,255,0.65)', fontSize: 14, flexShrink: 1 },
  tierUp: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tierUpText: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
})
