import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  AppState,
  BackHandler,
  useWindowDimensions,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Button } from '../ui'
import { useTheme, type Theme } from '../../theme'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'
import { BrainBoard } from './BrainBoard'
import { MAX_BOARD_WIDTH, mobilePlatform } from './brain-ui'

const PADDING = 16

/**
 * One round of one game, full screen — shared by free practice and Today's Training.
 *
 * The round is built for this screen (the column cap keeps every cell ≥ 56pt), so the width is
 * measured first and the round mounts after. Unmounting is how a round is abandoned; every timer
 * lives inside the hook.
 */
interface RoundViewProps {
  gameId: BrainGameId
  onOver: (stats: RoundStats) => void
  /** A line above the game's name — Today's Training says which game of the session this is. */
  caption?: string
  /**
   * Ask before stopping even when this round has counted nothing yet. In Today's Training a stop
   * ends the whole session, uncounted, so a slip at the start of the third game costs the first two.
   */
  confirmEmpty?: boolean
}

export function RoundView(props: RoundViewProps) {
  const [width, setWidth] = useState<number | null>(null)
  return (
    <View
      style={styles.root}
      // Only the first measurement: the round's grid size is fixed when it starts.
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width
        setWidth((prev) => prev ?? w)
      }}
    >
      {width === null ? null : <Round {...props} width={width} />}
    </View>
  )
}

function Round({ gameId, onOver, caption, confirmEmpty = false, width }: RoundViewProps & { width: number }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const screen = useWindowDimensions()
  const boardWidth = Math.min(width - PADDING * 2, MAX_BOARD_WIDTH)
  const [platform] = useState(() => mobilePlatform(boardWidth, Math.min(screen.width, screen.height)))
  const r = useBrainRound(gameId, platform)
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const variant = useBrainStore((s) => s.progress.quickEye.variant)
  const [boardHeight, setBoardHeight] = useState<number | null>(null)
  const { stop, pause, resume } = r

  // ── The round's end, reported once ─────────────────────────────────────────
  // On `done`, not `over`: the hook records the round (and settles "is this a personal best") one
  // render after it ends, and `done` turns true only then.
  const reported = useRef(false)
  useEffect(() => {
    if (!r.done || reported.current) return
    reported.current = true
    onOver(r.stats)
  }, [r.done, r.stats, onOver])

  // One buzz per judged trial. A voided trial was not the player's doing, so it gets none.
  useEffect(() => {
    if (!r.result || r.result.void) return
    if (r.result.correct) haptics.success()
    else haptics.error()
  }, [r.result])

  // "Practice done" for a moment when the practice trials run out, then the hearts.
  const [practiceJustEnded, setPracticeJustEnded] = useState(false)
  const wasPractice = useRef(r.practice)
  useEffect(() => {
    const justEnded = wasPractice.current && !r.practice
    wasPractice.current = r.practice
    if (!justEnded) return
    setPracticeJustEnded(true)
    const timer = setTimeout(() => setPracticeJustEnded(false), 1800)
    return () => clearTimeout(timer)
  }, [r.practice])

  // ── Leaving ────────────────────────────────────────────────────────────────
  const live = useRef({ over: r.over, paused: r.paused, canPause: r.canPause, trials: r.stats.trials })
  live.current = { over: r.over, paused: r.paused, canPause: r.canPause, trials: r.stats.trials }

  const finish = useCallback(() => {
    const now = live.current
    if (now.over) return
    // Nothing counted yet (or only practice): nothing to lose, nothing to confirm.
    if (now.trials === 0 && !confirmEmpty) return stop()
    // Hold the clocks while the question is up, so a trial cannot time out behind it.
    const holding = now.canPause && !now.paused
    if (holding) pause()
    Alert.alert(t('play.stop'), t('play.stopConfirm'), [
      { text: t('play.resume'), style: 'cancel', onPress: () => holding && resume() },
      { text: t('play.stop'), style: 'destructive', onPress: stop },
    ])
  }, [t, stop, pause, resume, confirmEmpty])

  // Android's back button is the same as "Finish", confirmation included.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (live.current.over) return false
      finish()
      return true
    })
    return () => sub.remove()
  }, [finish])

  // A phone call or a notification should not cost a chance: the round pauses when the app leaves
  // the foreground. (A Quick Eye stimulus cannot pause; the engine voids it if it never finished.)
  const wantPause = useRef(false)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const now = live.current
      if (state === 'active' || now.over || now.paused) return
      // Mid-flash (Quick Eye's stimulus cannot pause) the request is remembered, not dropped.
      if (now.canPause) pause()
      else wantPause.current = true
    })
    return () => sub.remove()
  }, [pause])
  useEffect(() => {
    if (wantPause.current && r.canPause && !r.paused && !r.over) {
      wantPause.current = false
      pause()
    }
  }, [r.canPause, r.paused, r.over, pause])

  // ── What the header and the result line say ─────────────────────────────────
  const levelText =
    gameId === 'quickEye'
      ? t('home.quickEyeLevel', { stage: variant, speed: Math.round(r.level) })
      : t('home.level', { level: r.level })
  const result = r.result
  const resultText = !result
    ? null
    : result.void
      ? t('play.void')
      : result.correct
        ? t('play.correct')
        : result.timedOut
          ? result.livesLost === 0 && timing !== 1
            ? t('play.timeUpForgiven')
            : t('play.timeUp')
          : t('play.wrong')
  const resultColor = !result || result.void ? theme.colors.textSecondary : result.correct ? theme.colors.success : theme.colors.error
  // Quick Eye's level is its exposure step, shown as "speed" — a "Lv." line would misname it.
  const leveledUp =
    result !== null &&
    !result.practice &&
    !result.void &&
    gameId !== 'quickEye' &&
    displayLevel(result.levelAfter) > displayLevel(result.levelBefore)
  const practiceCount = Math.min(r.practiceTotal, result?.practice ? r.practiceDone : r.practiceDone + 1)

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={finish}
          style={({ pressed }) => [styles.finish, pressed && { backgroundColor: theme.colors.surface }]}
          accessibilityRole="button"
          testID={'brain-finish'}
        >
          <Feather name="x" size={20} color={theme.colors.textSecondary} />
          <Text style={[styles.finishText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {t('play.stop')}
          </Text>
        </Pressable>
        <View style={styles.title}>
          {caption ? (
            <Text style={[styles.caption, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
          <Text style={[styles.gameName, { color: theme.colors.text }]} numberOfLines={1}>
            {t(`games.${gameId}.name`)}
          </Text>
          <Text style={[styles.level, { color: theme.colors.textSecondary }]} numberOfLines={1} testID={'brain-level'}>
            {levelText}
          </Text>
        </View>
        <Pressable
          onPress={r.paused ? resume : pause}
          disabled={!r.canPause}
          style={({ pressed }) => [styles.iconButton, { opacity: r.canPause ? 1 : 0.4 }, pressed && { backgroundColor: theme.colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel={r.paused ? t('play.resume') : t('play.pause')}
          accessibilityState={{ disabled: !r.canPause }}
          testID="brain-pause"
        >
          <Feather name={r.paused ? 'play' : 'pause'} size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={[styles.score, { color: theme.colors.text }]} accessibilityLabel={`${t('play.score')} ${formatCount(r.stats.points)}`} testID={'brain-score'}>
          {formatCount(r.stats.points)}
        </Text>
      </View>

      {/* Chances, calm: no red, no flashing — gamification already makes a task feel harder. */}
      <View style={styles.livesRow}>
        {r.practice ? (
          <Text style={[styles.practice, { color: theme.colors.primary }]} numberOfLines={2} testID={'brain-practice'}>
            {t('play.practice', { done: practiceCount, total: r.practiceTotal })} · {t('play.practiceHint')}
          </Text>
        ) : practiceJustEnded ? (
          <Text style={[styles.practice, { color: theme.colors.primary }]}>{t('play.practiceDone')}</Text>
        ) : (
          <>
            <Lives
              lives={r.lives}
              max={r.maxLives}
              label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: r.lives })}
              theme={theme}
            />
            {r.roundCap !== null ? (
              <Text style={[styles.trial, { color: theme.colors.textSecondary }]}>
                {t('play.trial', { done: r.trialInRound, total: r.roundCap })}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <TimerBar key={r.trialId} timer={r.timer} theme={theme} />

      <View style={styles.body}>
        <Text style={[styles.prompt, { color: theme.colors.text }]} numberOfLines={2} testID={'brain-prompt'}>
          {t(r.view.prompt.key, r.view.prompt.params)}
        </Text>
        <View
          style={styles.board}
          onLayout={(e) => {
            const h = Math.floor(e.nativeEvent.layout.height)
            setBoardHeight((prev) => (prev === h ? prev : h))
          }}
        >
          {boardHeight === null ? null : (
            <BrainBoard
              key={r.trialId}
              view={r.view}
              onTap={r.tap}
              onExposure={r.reportExposure}
              width={boardWidth}
              height={boardHeight}
            />
          )}
        </View>
        <View style={styles.resultRow} accessibilityLiveRegion="polite">
          {result && resultText ? (
            <Text style={[styles.result, { color: resultColor }]} testID={'brain-result'}>
              {resultText}
              {result.points > 0 ? (
                <Text style={{ color: theme.colors.primary }}>  {t('play.points', { value: formatCount(result.points) })}</Text>
              ) : null}
              {leveledUp ? (
                <Text style={{ color: theme.colors.text }}>  {t('play.levelUp', { level: displayLevel(result.levelAfter) })}</Text>
              ) : null}
            </Text>
          ) : null}
        </View>

        {r.paused ? (
          <View style={[styles.paused, { backgroundColor: theme.colors.background }]} {...testProps('brain-paused', true)}>
            <Text style={[styles.pausedText, { color: theme.colors.text }]}>{t('play.paused')}</Text>
            <Button title={t('play.resume')} onPress={resume} size="lg" fullWidth={false} style={styles.resume} testID="brain-resume" />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Remaining chances as filled hearts, spent ones as outlines — the shape tells them apart, not
 * only the colour. Feather has no filled heart, so the filled one is drawn.
 */
function Lives({ lives, max, label, theme }: { lives: number; max: number; label: string; theme: Theme }) {
  return (
    <View style={styles.lives} accessible accessibilityRole="image" accessibilityLabel={label} testID="brain-lives">
      {Array.from({ length: max }, (_, i) => (
        // The drawn heart fills its box edge to edge; Feather's glyph leaves a margin, so the
        // filled one is drawn a little smaller to read as the same heart.
        <View key={i} style={styles.heart}>
          {i < lives ? <FilledHeart size={18} color={theme.colors.text} /> : <Feather name="heart" size={22} color={theme.colors.textTertiary} />}
        </View>
      ))}
    </View>
  )
}

/** A rotated square and two circles — the classic drawn heart, in a box the size of the icon. */
function FilledHeart({ size, color }: { size: number; color: string }) {
  const a = size / 1.707
  const cx = size / 2
  const cy = (size - 1.561 * a) / 2 + 0.854 * a
  const offset = a / (2 * Math.SQRT2)
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', width: a, height: a, left: cx - a / 2, top: cy - a / 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', width: a, height: a, borderRadius: a / 2, left: cx - offset - a / 2, top: cy - offset - a / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: a, height: a, borderRadius: a / 2, left: cx + offset - a / 2, top: cy - offset - a / 2, backgroundColor: color }} />
    </View>
  )
}

/** Drains from full to empty over the trial's limit, on the native driver. */
function TimerBar({ timer, theme }: { timer: { startedAt: number; limitMs: number } | null; theme: Theme }) {
  const scale = useRef(new Animated.Value(1)).current
  const startedAt = timer?.startedAt
  const limitMs = timer?.limitMs
  useEffect(() => {
    if (startedAt === undefined || limitMs === undefined) return
    const elapsed = Math.max(0, Date.now() - startedAt)
    scale.setValue(Math.max(0, 1 - elapsed / limitMs))
    const anim = Animated.timing(scale, {
      toValue: 0,
      duration: Math.max(0, limitMs - elapsed),
      easing: Easing.linear,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [startedAt, limitMs, scale])
  return (
    <View style={[styles.track, { backgroundColor: theme.colors.surface }]}>
      {timer ? <Animated.View style={[styles.fill, { backgroundColor: theme.colors.primary, transform: [{ scaleX: scale }] }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  finish: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 10,
    borderRadius: 12,
    maxWidth: 120,
  },
  finishText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  caption: { fontSize: 15 },
  gameName: { fontSize: 17, fontWeight: '700' },
  level: { fontSize: 15 },
  iconButton: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  score: { minWidth: 48, fontSize: 18, fontWeight: '700', textAlign: 'right', paddingRight: 8, fontVariant: ['tabular-nums'] },
  livesRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: PADDING,
  },
  lives: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heart: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  trial: { fontSize: 15, fontVariant: ['tabular-nums'] },
  practice: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  track: { height: 6, borderRadius: 3, marginHorizontal: PADDING, overflow: 'hidden' },
  fill: { height: 6, width: '100%', borderRadius: 3, transformOrigin: 'left' },
  body: { flex: 1, paddingHorizontal: PADDING, paddingTop: 12, paddingBottom: 16, gap: 12 },
  // Two lines reserved, so a prompt that wraps never moves the board under the player's finger.
  prompt: { fontSize: 18, lineHeight: 25, fontWeight: '600', textAlign: 'center', minHeight: 50 },
  board: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resultRow: { minHeight: 32, justifyContent: 'center' },
  result: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  paused: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    opacity: 0.97,
  },
  pausedText: { fontSize: 24, fontWeight: '700' },
  resume: { minWidth: 200 },
})
