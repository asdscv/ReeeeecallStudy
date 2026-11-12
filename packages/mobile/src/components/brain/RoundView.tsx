import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, AccessibilityInfo, AppState, BackHandler, Platform, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, comboMultiplier, quickEyeMsAt, streakTier, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainFx, type BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { areHapticsEnabled, haptics, setHapticsEnabled } from '../../utils/haptics'
import { localPrefs } from '../../utils/local-prefs'
import { BrainBoard } from './BrainBoard'
import { CanvasButton, CanvasOverlay, CanvasSheet, Countdown, GameCanvas } from './GameCanvas'
import { brainHaptic } from './fx-haptics'
import { useMotion } from './motion'
import { FX, MAX_BOARD_WIDTH, flushBrainStorage, mobilePlatform } from './brain-ui'

const PADDING = 16
/** In-round text may grow with the system font, but only so far: the board must keep its room. */
const HUD_SCALE = 1.3

/**
 * One round of one game, full screen on the game's canvas — shared by free practice and Today's
 * Training: a countdown, then trials until the chances run out, the round's cap is reached, or the
 * player stops.
 *
 * The round is built for this screen (the column cap keeps every cell ≥ 56dp), so the width is
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
  /** The stop sheet's line (Today's Training explains the session will not count). */
  stopBody?: string
  countdown?: boolean
}

export function RoundView({ countdown = true, ...props }: RoundViewProps) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[props.gameId]
  const [width, setWidth] = useState<number | null>(null)
  const [counting, setCounting] = useState(countdown)

  // During the countdown there is nothing to stop yet. In Today's Training Android's back button
  // would leave the session without a word, so it waits the two seconds; in free practice it leaves.
  const { confirmEmpty } = props
  useEffect(() => {
    if (!counting || !confirmEmpty) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [counting, confirmEmpty])

  // Whatever the round saved reaches disk when it closes.
  useEffect(() => () => flushBrainStorage(), [])

  return (
    <GameCanvas theme={theme} testID="brain-round">
      <View
        style={styles.root}
        // Only the first measurement: the round's grid size is fixed when it starts.
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width
          setWidth((prev) => prev ?? w)
        }}
      >
        {width === null ? null : counting ? (
          <>
            <HudShell gameId={props.gameId} caption={props.caption} />
            <Countdown goLabel={t('play.go')} onDone={() => setCounting(false)} />
          </>
        ) : (
          <Round {...props} width={width} theme={theme} />
        )}
      </View>
    </GameCanvas>
  )
}

/** The header as it will look, while the countdown runs — so nothing jumps when play starts. */
function HudShell({ gameId, caption }: { gameId: BrainGameId; caption?: string }) {
  const { t } = useTranslation('brain')
  const compact = useWindowDimensions().height < 700
  return (
    <View style={styles.header}>
      <View style={styles.headerSide} />
      <View style={styles.title}>
        {caption && !compact ? (
          <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE}>
            {caption}
          </Text>
        ) : null}
        <Text style={styles.gameName} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE}>
          {t(`games.${gameId}.name`)}
        </Text>
      </View>
      <View style={styles.headerSide} />
    </View>
  )
}

interface Pop {
  id: number
  text: string
}

function Round({
  gameId,
  onOver,
  caption,
  confirmEmpty = false,
  stopBody,
  width,
  theme,
}: RoundViewProps & { width: number; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const screen = useWindowDimensions()
  const compact = screen.height < 700
  const boardWidth = Math.min(width - PADDING * 2, MAX_BOARD_WIDTH)
  const [platform] = useState(() => mobilePlatform(boardWidth, Math.min(screen.width, screen.height)))
  const r = useBrainRound(gameId, platform)
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const variant = useBrainStore((s) => s.progress.quickEye.variant)
  const [boardHeight, setBoardHeight] = useState<number | null>(null)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null)
  const [burst, setBurst] = useState<{ id: number; ok: boolean } | null>(null)
  const [heartHit, setHeartHit] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  const seq = useRef(0)

  // The latest round for handlers that outlive a render (back button, app state, fx).
  const live = useRef({ r, confirming })
  useEffect(() => {
    live.current = { r, confirming }
  })

  // ── Effects: haptics, the verdict burst, "+N", banners, hearts ─────────────
  const onFx = useCallback(
    (fx: BrainFx) => {
      brainHaptic(fx)
      const id = ++seq.current
      if (fx.kind === 'correct') {
        setBurst({ id, ok: true })
        if (!fx.practice && fx.points > 0) setPops((p) => [...p.slice(-3), { id, text: `+${formatCount(fx.points)}` }])
        if ([5, 10, 15, 20, 30, 40, 50].includes(fx.streak)) setBanner({ id, text: t('play.streakBanner', { value: fx.streak }) })
      }
      if (fx.kind === 'wrong') setBurst({ id, ok: false })
      if ((fx.kind === 'correct' || fx.kind === 'wrong') && fx.practice) {
        // The last practice trial's verdict: say the counted round starts next.
        const cur = live.current.r
        if (cur.practiceDone >= cur.practiceTotal) setBanner({ id, text: t('play.practiceDone') })
      }
      if (fx.kind === 'lifeLost') setHeartHit(id)
      if (fx.kind === 'levelUp') setBanner({ id, text: gameId === 'quickEye' ? t('play.fasterBanner') : t('play.levelUpBanner', { level: fx.level }) })
      if (fx.kind === 'roundEnd' && fx.reason !== 'stop') setEnding(true)
    },
    [gameId, t],
  )
  useBrainFx(r, onFx)

  useEffect(() => {
    if (!banner) return
    const tm = setTimeout(() => setBanner(null), 1600)
    return () => clearTimeout(tm)
  }, [banner])
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 650)
    return () => clearTimeout(tm)
  }, [burst])

  // ── The round's end, reported once ─────────────────────────────────────────
  // On `done`, not `over`: one render later the personal-best flag is settled. A round that ran
  // out holds its "round over" stamp for a moment first.
  const reported = useRef(false)
  useEffect(() => {
    if (!r.done || reported.current) return
    const tm = setTimeout(() => {
      if (reported.current) return
      reported.current = true
      onOver(r.stats)
    }, r.stats.endedBy === 'stop' ? 0 : 1300)
    return () => clearTimeout(tm)
  }, [r.done, r.stats, onOver])

  // ── Stopping ───────────────────────────────────────────────────────────────
  // The stop sheet pauses the round underneath it: the trial's deadline must not run out while the
  // player decides, or "keep playing" would land straight on a timeout.
  const pausedForSheet = useRef(false)
  const askStop = useCallback(() => {
    const cur = live.current.r
    if (cur.over) return
    // Nothing counted yet (or only practice): nothing to lose, nothing to confirm.
    if (cur.stats.trials === 0 && !confirmEmpty) return cur.stop()
    pausedForSheet.current = cur.canPause && !cur.paused
    if (pausedForSheet.current) cur.pause()
    setConfirming(true)
  }, [confirmEmpty])
  const cancelStop = useCallback(() => {
    setConfirming(false)
    if (pausedForSheet.current) live.current.r.resume()
    pausedForSheet.current = false
  }, [])
  const confirmStop = useCallback(() => {
    setConfirming(false)
    pausedForSheet.current = false
    live.current.r.stop()
  }, [])

  // Android's back button: the stop sheet (the round paused under it), never straight out.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const { r: cur, confirming: asking } = live.current
      if (asking) cancelStop()
      // The "round over" stamp holds for a moment; the results come next by themselves.
      else if (!cur.over) askStop()
      return true
    })
    return () => sub.remove()
  }, [askStop, cancelStop])

  // A phone call, a notification or the Android shade should not cost a chance: the round pauses
  // when the app loses the foreground. (A Quick Eye stimulus cannot pause; the request is kept and
  // taken as soon as the round can pause — the engine voids a flash that never finished.)
  const wantPause = useRef(false)
  useEffect(() => {
    const away = () => {
      const cur = live.current.r
      if (cur.over || cur.paused) return
      if (cur.canPause) cur.pause()
      else wantPause.current = true
    }
    const subs = [AppState.addEventListener('change', (state) => state !== 'active' && away())]
    // Android stays 'active' under the notification shade or a system dialog; it sends 'blur'.
    if (Platform.OS === 'android') subs.push(AppState.addEventListener('blur', away))
    return () => subs.forEach((s) => s.remove())
  }, [])
  const { canPause, paused, over, pause } = r
  useEffect(() => {
    if (wantPause.current && canPause && !paused && !over) {
      wantPause.current = false
      pause()
    }
  }, [canPause, paused, over, pause])

  // ── What the HUD says ──────────────────────────────────────────────────────
  // Number Hunt spends a life per wrong tap inside its grid: show them going as they go.
  const liveLives = gameId === 'schulte' && typeof r.view.prompt.params?.lives === 'number' && !r.result ? Number(r.view.prompt.params.lives) : r.lives
  const levelText =
    gameId === 'quickEye'
      ? `${t('quickEye.stage', { stage: variant })} · ${t('quickEye.flashMs', { ms: formatCount(quickEyeMsAt(r.level, platform.minExposureMs)) })}`
      : t('home.level', { level: r.level.toFixed(1) })
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
  const resultColor = !result || result.void ? 'rgba(255,255,255,0.7)' : result.correct ? FX.goodText : FX.badText
  const tier = streakTier(r.stats.streak)
  const capProgress = r.roundCap !== null && !r.practice ? r.trialInRound / r.roundCap : null
  const practiceCount = Math.min(r.practiceTotal, r.practiceDone + (result ? 0 : 1))

  // VoiceOver has no live regions: say the verdict out loud (TalkBack hears the polite region).
  useEffect(() => {
    if (Platform.OS === 'ios' && resultText) AccessibilityInfo.announceForAccessibility(resultText)
  }, [resultText, r.trialId])

  const covered = r.paused || confirming || ending

  return (
    <View style={styles.root}>
      <View style={styles.root} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={covered}>
        <View style={styles.header}>
          <CanvasButton variant="chip" icon="x" onPress={askStop} theme={theme} accessibilityLabel={t('play.stop')} testID="brain-finish" />
          <View style={styles.title}>
            {caption && !compact ? (
              <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE}>
                {caption}
              </Text>
            ) : null}
            <Text style={styles.gameName} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE}>
              {t(`games.${gameId}.name`)}
            </Text>
            <Text style={[styles.level, { color: theme.accent }]} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE} testID="brain-level">
              {levelText}
            </Text>
          </View>
          <CanvasButton
            variant="chip"
            icon={r.paused ? 'play' : 'pause'}
            onPress={r.paused ? r.resume : r.pause}
            theme={theme}
            accessibilityLabel={r.paused ? t('play.resume') : t('play.pause')}
            disabled={!r.canPause}
            testID="brain-pause"
          />
        </View>

        {/* Score, run and chances. */}
        <View style={[styles.scoreRow, compact && styles.scoreRowCompact]}>
          <View style={styles.scoreBox}>
            <Text
              style={[styles.score, compact && styles.scoreCompact, { textShadowColor: theme.glow }]}
              maxFontSizeMultiplier={1.15}
              accessibilityLabel={`${t('play.score')} ${formatCount(r.stats.points)}`}
              testID="brain-score"
            >
              {formatCount(r.stats.points)}
            </Text>
            <Text style={styles.scoreLabel} maxFontSizeMultiplier={1.15}>
              {t('play.score')}
            </Text>
            {pops.map((p) => (
              <ScorePop key={p.id} text={p.text} color={theme.accent} onDone={() => setPops((list) => list.filter((x) => x.id !== p.id))} />
            ))}
          </View>

          {tier > 0 && !r.practice ? (
            <Streak tier={tier} streak={r.stats.streak} label={t('play.streakCount', { value: r.stats.streak })} />
          ) : (
            <View />
          )}

          {r.practice ? (
            <View style={styles.practicePill} testID="brain-lives">
              <Text style={styles.practiceText} numberOfLines={1} maxFontSizeMultiplier={HUD_SCALE}>
                {t('play.practice', { done: practiceCount, total: r.practiceTotal })}
              </Text>
            </View>
          ) : (
            <Hearts lives={liveLives} max={r.maxLives} hit={heartHit} label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: liveLives })} />
          )}
        </View>

        {/* The round's progress (capped rounds), then this trial's clock. */}
        <View style={[styles.bars, compact && styles.barsCompact]}>
          {/* Its room is kept during practice too, so the board does not resize when practice ends. */}
          {capProgress !== null ? <CapBar progress={capProgress} /> : r.roundCap !== null ? <View style={styles.capSpacer} /> : null}
          <TimerBar key={r.trialId} timer={r.timer} accent={theme.accent} />
        </View>

        <View style={[styles.body, compact && styles.bodyCompact]}>
          <Prompt key={`${r.trialId}-${r.view.prompt.key}`} text={t(r.view.prompt.key, r.view.prompt.params)} compact={compact} />
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
                theme={theme}
                paused={r.paused}
              />
            )}
            {/* The verdict, big and brief, over the board. */}
            {burst ? <Burst key={burst.id} ok={burst.ok} /> : null}
          </View>
          <View style={[styles.resultRow, compact && styles.resultRowCompact]} accessibilityLiveRegion="polite" pointerEvents="none">
            {banner ? (
              <BannerPill key={banner.id} text={banner.text} />
            ) : result && resultText ? (
              <ResultLine key={r.trialId} text={resultText} color={resultColor} />
            ) : r.practice ? (
              <Text style={styles.hint} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={HUD_SCALE}>
                {t('play.practiceHint')}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      {r.paused && !confirming ? (
        <CanvasOverlay testID="brain-paused" opaque theme={theme}>
          <View style={styles.sheet}>
            <Text style={styles.overlayTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              {t('play.paused')}
            </Text>
            <CanvasButton icon="play" label={t('play.resume')} onPress={r.resume} theme={theme} testID="brain-resume" style={styles.sheetButton} />
            <CanvasButton label={t('play.stop')} onPress={askStop} theme={theme} variant="glass" style={styles.sheetButton} />
            <VibrationToggle label={t('settings.haptics')} accent={theme.accent} />
          </View>
        </CanvasOverlay>
      ) : null}

      {confirming ? (
        <CanvasSheet
          theme={theme}
          testID="brain-stop-sheet"
          title={t('play.stopTitle')}
          body={stopBody ?? t('play.stopBody')}
          keepLabel={t('play.keepPlaying')}
          onKeep={cancelStop}
          keepTestID="brain-stop-cancel"
          stopLabel={t('play.stopNow')}
          onStop={confirmStop}
          stopTestID="brain-stop-confirm"
        />
      ) : null}

      {ending ? <RoundOver endedBy={r.stats.endedBy} cleared={t('play.roundCleared')} over={t('play.roundOver')} theme={theme} /> : null}
    </View>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/**
 * The pause screen's quick switch — the web has its game sound here; the phone's games speak
 * through vibration, so this is the app-wide vibration setting (the one Settings shows).
 */
function VibrationToggle({ label, accent }: { label: string; accent: string }) {
  const [on, setOn] = useState(areHapticsEnabled)
  return (
    <Pressable
      onPress={() => {
        const next = !on
        setOn(next)
        setHapticsEnabled(next)
        localPrefs.setHapticsEnabled(next)
        if (next) haptics.success()
      }}
      style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      testID="brain-pause-haptics"
    >
      <Feather name={on ? 'zap' : 'zap-off'} size={20} color="rgba(255,255,255,0.85)" />
      <Text style={styles.toggleText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      <View style={[styles.track, { backgroundColor: on ? accent : 'rgba(255,255,255,0.2)' }]}>
        <View style={[styles.knob, on ? styles.knobOn : null]} />
      </View>
    </Pressable>
  )
}

function Prompt({ text, compact }: { text: string; compact: boolean }) {
  // Once per mount — the prompt is keyed by trial and prompt key, so a live counter in it ("next:
  // 7") updates in place instead of sliding in again on every tap.
  const rise = useMotion('rise', 0)
  return (
    <View style={[styles.promptBox, compact && styles.promptBoxCompact]} pointerEvents="none">
      <Animated.Text
        style={[styles.prompt, compact && styles.promptCompact, rise]}
        // Two lines reserved; a long prompt shrinks rather than cutting off its live counter.
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        maxFontSizeMultiplier={HUD_SCALE}
        testID="brain-prompt"
      >
        {text}
      </Animated.Text>
    </View>
  )
}

function ResultLine({ text, color }: { text: string; color: string }) {
  const rise = useMotion('rise', text)
  return (
    <Animated.Text style={[styles.result, { color }, rise]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={HUD_SCALE} testID="brain-result">
      {text}
    </Animated.Text>
  )
}

function BannerPill({ text }: { text: string }) {
  const pop = useMotion('pop', text)
  return (
    <Animated.View style={[styles.banner, pop]} testID="brain-banner">
      <Text style={styles.bannerText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={HUD_SCALE}>
        {text}
      </Text>
    </Animated.View>
  )
}

/** "+120" rising from the score and fading (the web's bfx-float). */
function ScorePop({ text, color, onDone }: { text: string; color: string; onDone: () => void }) {
  const reduced = useReducedMotion()
  const y = useSharedValue(0)
  const o = useSharedValue(reduced ? 1 : 0)
  const s = useSharedValue(reduced ? 1 : 0.8)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (!reduced) {
      y.value = withSequence(withTiming(-8, { duration: 135 }), withTiming(-64, { duration: 765, easing: Easing.out(Easing.quad) }))
      o.value = withSequence(withTiming(1, { duration: 135 }), withTiming(0, { duration: 765 }))
      s.value = withSequence(withTiming(1.1, { duration: 135 }), withTiming(1, { duration: 765 }))
    }
    const tm = setTimeout(() => done.current(), 900)
    return () => clearTimeout(tm)
    // Once per pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }, { scale: s.value }] }))
  return (
    <Animated.Text style={[styles.pop, { color }, style]} allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no">
      {text}
    </Animated.Text>
  )
}

function Streak({ tier, streak, label }: { tier: number; streak: number; label: string }) {
  const pop = useMotion('pop', tier)
  const bg = tier >= 3 ? '#F97316' : tier === 2 ? 'rgba(251,146,60,0.9)' : 'rgba(255,255,255,0.14)'
  return (
    <Animated.View style={[styles.streak, { backgroundColor: bg }, tier >= 3 && styles.streakHot, pop]} testID="brain-streak">
      <Feather name="zap" size={18} color="#FFFFFF" />
      <Text style={styles.streakText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
      <Text style={styles.streakMult} maxFontSizeMultiplier={1.2}>
        ×{comboMultiplier(streak)}
      </Text>
    </Animated.View>
  )
}

/**
 * Remaining chances as filled hearts, spent ones as faint outlines — the shape tells them apart,
 * not only the colour. On a lost life the row shakes and the heart just spent pops as it empties.
 */
function Hearts({ lives, max, hit, label }: { lives: number; max: number; hit: number; label: string }) {
  const shake = useMotion(hit ? 'shake' : null, hit)
  return (
    <Animated.View style={[styles.hearts, shake]} accessible accessibilityRole="image" accessibilityLabel={label} testID="brain-lives">
      {Array.from({ length: max }, (_, i) => (
        <Heart key={i} full={i < lives} justLost={hit !== 0 && i === lives} hit={hit} />
      ))}
    </Animated.View>
  )
}

function Heart({ full, justLost, hit }: { full: boolean; justLost: boolean; hit: number }) {
  const pop = useMotion(justLost ? 'pop' : null, justLost ? hit : 0)
  return (
    <Animated.View style={[styles.heart, pop]}>
      {full ? <FilledHeart size={20} color={FX.heart} /> : <Feather name="heart" size={22} color="rgba(255,255,255,0.3)" />}
    </Animated.View>
  )
}

/** A rotated square and two circles — the classic drawn heart (Feather has no filled one). */
function FilledHeart({ size, color }: { size: number; color: string }) {
  const a = size / 1.707
  const cx = size / 2
  const cy = (size - 1.561 * a) / 2 + 0.854 * a
  const offset = a / (2 * Math.SQRT2)
  return (
    <View style={{ width: size, height: size, boxShadow: `0 0 8px rgba(251,113,133,0.6)`, borderRadius: size / 2 }}>
      <View style={{ position: 'absolute', width: a, height: a, left: cx - a / 2, top: cy - a / 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', width: a, height: a, borderRadius: a / 2, left: cx - offset - a / 2, top: cy - offset - a / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: a, height: a, borderRadius: a / 2, left: cx + offset - a / 2, top: cy - offset - a / 2, backgroundColor: color }} />
    </View>
  )
}

/** The big ✓ / ✗ over the board for a beat after each verdict. */
function Burst({ ok }: { ok: boolean }) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(reduced ? 1 : 0.88)
  const opacity = useSharedValue(1)
  useEffect(() => {
    if (reduced) return
    scale.value = withSequence(withTiming(1.08, { duration: 132, easing: Easing.out(Easing.cubic) }), withTiming(1, { duration: 108 }))
    opacity.value = withSequence(withTiming(1, { duration: 380 }), withTiming(0, { duration: 270 }))
    // Once per burst (it is keyed by verdict).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }))
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.burst,
          { backgroundColor: ok ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)', boxShadow: ok ? '0 0 60px rgba(34,197,94,0.6)' : '0 0 60px rgba(239,68,68,0.5)' },
          style,
        ]}
      >
        <Feather name={ok ? 'check' : 'x'} size={56} color="#FFFFFF" />
      </Animated.View>
    </View>
  )
}

function RoundOver({ endedBy, cleared, over, theme }: { endedBy: RoundStats['endedBy']; cleared: string; over: string; theme: GameTheme }) {
  const pop = useMotion('pop', endedBy)
  const rise = useMotion('rise', endedBy)
  return (
    <CanvasOverlay testID="brain-round-over" theme={theme}>
      <Animated.View style={[styles.stamp, pop]}>
        {endedBy === 'cap' ? (
          <Feather name="award" size={48} color={FX.gold} />
        ) : endedBy === 'lives' ? (
          <Feather name="heart" size={48} color={FX.heart} />
        ) : (
          <Feather name="flag" size={48} color="#FFFFFF" />
        )}
      </Animated.View>
      <Animated.Text style={[styles.overlayTitle, rise]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {endedBy === 'cap' ? cleared : over}
      </Animated.Text>
    </CanvasOverlay>
  )
}

function CapBar({ progress }: { progress: number }) {
  const k = useSharedValue(progress)
  useEffect(() => {
    k.value = withTiming(progress, { duration: 300 })
    // `k` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, k.value) }] }))
  return (
    <View style={styles.capTrack}>
      <Animated.View style={[styles.capFill, fill]} />
    </View>
  )
}

/**
 * Drains from full to empty over the trial's limit, on the UI thread. The last third warms to amber
 * and the last sixth to red, so time pressure shows without a ticking sound. It is information,
 * not decoration, so it keeps running under reduce motion.
 */
function TimerBar({ timer, accent }: { timer: { startedAt: number; limitMs: number } | null; accent: string }) {
  const p = useSharedValue(1)
  const startedAt = timer?.startedAt
  const limitMs = timer?.limitMs
  useEffect(() => {
    if (startedAt === undefined || limitMs === undefined) return
    const elapsed = Math.max(0, Date.now() - startedAt)
    p.value = Math.max(0, 1 - elapsed / limitMs)
    p.value = withTiming(0, { duration: Math.max(0, limitMs - elapsed), easing: Easing.linear, reduceMotion: ReduceMotion.Never })
    return () => cancelAnimation(p)
    // `p` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, limitMs])
  const fill = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.0001, p.value) }],
    backgroundColor: interpolateColor(p.value, [0, 0.16, 0.33, 1], [FX.red, FX.amber, accent, accent]),
  }))
  return <View style={styles.timerTrack}>{timer ? <Animated.View style={[styles.timerFill, fill]} /> : null}</View>
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  /*
   * The board gets whatever height is left, so the chrome is counted: on a short phone (under 700dp
   * — a 360×640 Android with 3-button navigation leaves 568) it slims to ~232dp, which keeps Match
   * Pairs' 4×6 board at 48dp cells with no scrolling.
   */
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4, minHeight: 52 },
  headerSide: { width: 48 },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  caption: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  gameName: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  level: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: PADDING, minHeight: 48 },
  scoreRowCompact: { minHeight: 44 },
  scoreBox: { minWidth: 88 },
  // A small glow only: iOS clips a text shadow to the text's frame, and a wide one shows as a box.
  score: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '900', fontVariant: ['tabular-nums'], textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } },
  scoreCompact: { fontSize: 26, lineHeight: 30 },
  scoreLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  pop: { position: 'absolute', left: '100%', top: 0, marginLeft: 6, fontSize: 20, fontWeight: '800' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 18, flexShrink: 1 },
  streakHot: { boxShadow: '0 0 18px rgba(245,158,11,0.55)' },
  streakText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', flexShrink: 1 },
  streakMult: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
  practicePill: { height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  practiceText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  hearts: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heart: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  bars: { paddingHorizontal: PADDING, paddingTop: 8, gap: 6 },
  barsCompact: { paddingTop: 6 },
  capSpacer: { height: 6 },
  capTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  capFill: { height: 6, width: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)', transformOrigin: 'left' },
  timerTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  timerFill: { height: 8, width: '100%', borderRadius: 4, transformOrigin: 'left' },
  body: { flex: 1, paddingHorizontal: PADDING, paddingTop: 10, paddingBottom: 8, gap: 8 },
  bodyCompact: { paddingTop: 6, paddingBottom: 6, gap: 6 },
  // Two lines reserved, so a prompt that wraps never moves the board under the player's finger.
  promptBox: { minHeight: 50, justifyContent: 'center' },
  promptBoxCompact: { minHeight: 46 },
  prompt: { color: '#FFFFFF', fontSize: 19, lineHeight: 25, fontWeight: '600', textAlign: 'center' },
  promptCompact: { fontSize: 17, lineHeight: 23 },
  board: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // A fixed slot: a long verdict shrinks into it instead of wrapping and resizing the board.
  resultRow: { height: 48, alignItems: 'center', justifyContent: 'center' },
  resultRowCompact: { height: 40 },
  result: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 19, textAlign: 'center' },
  banner: { maxWidth: '100%', paddingHorizontal: 18, height: 42, borderRadius: 21, backgroundColor: FX.gold, justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.35)' },
  bannerText: { color: '#0F172A', fontSize: 17, fontWeight: '800' },
  burst: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 360, alignItems: 'center', gap: 16, paddingHorizontal: 24 },
  sheetButton: { alignSelf: 'stretch' },
  overlayTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  toggle: {
    alignSelf: 'stretch',
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  toggleText: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 16 },
  track: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  knobOn: { alignSelf: 'flex-end' },
  stamp: { width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
})
