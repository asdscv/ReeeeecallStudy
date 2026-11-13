import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, AccessibilityInfo, AppState, BackHandler, Platform, useWindowDimensions } from 'react-native'
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
import { GAME_THEMES, QE_WARM, buildDemo, comboMultiplier, streakTier, type BrainGameId, type GameTheme, type QuickEyeView } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type LegMark, type RoundStats, type StageUp } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainFx, type BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { areHapticsEnabled, haptics, setHapticsEnabled } from '../../utils/haptics'
import { localPrefs } from '../../utils/local-prefs'
import { BrainBoard } from './BrainBoard'
import { CanvasButton, CanvasOverlay, CanvasSheet, Countdown, GameCanvas } from './GameCanvas'
import { brainHaptic } from './fx-haptics'
import { useMotion } from './motion'
import { CANVAS_INK, FX, MAX_BOARD_WIDTH, flushBrainStorage, mobilePlatform, type FeatherName } from './brain-ui'
import { qeSpeedLevel } from './tier-ui'

const PADDING = 16
/** In-round text may grow with the system font, but only so far: the board must keep its room. */
const HUD_SCALE = 1.3
/** How long a bigger board's notice stays up. */
const TOAST_MS = 3000
/**
 * What the round's chrome takes from the screen's height before the board (header, score row, the
 * bars, the prompt's two lines, the verdict line and the gaps between — see `styles`), at system
 * text size; the HUD's text grows with the system's up to HUD_SCALE, which adds up to
 * CHROME_PER_SCALE per whole step. The round is built before its board is measured, so its rows
 * (maxRows) come from this.
 */
const CHROME_H = 268
const CHROME_H_COMPACT = 232
const CHROME_PER_SCALE = 120
/** Quick Eye's stage-up preview: the new stage's flash, faint — on the dark scrim a quarter-opacity board all but vanished. */
const PREVIEW_OPACITY = 0.5

/**
 * One round of one game, full screen on the game's canvas — shared by free practice and Today's
 * Training: a countdown, then trials until the chances run out, the round's cap is reached, or the
 * player stops.
 *
 * Quick Eye has no chances: a leg of 20 trials, drawn as a bar of marks, with its speed gauge in
 * the hearts' place and a short interstitial when a stage is reached. While its display is being
 * measured (`r.quiet`: fixation, stimulus, mask) this screen sets no state — a chip, a count-up or
 * a notice due then waits, so no React work lands on the frames being counted.
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
  /** Today's Training: the slot's play time left; the round ends after the trial in play when it is up. */
  timeBudgetMs?: number
}

export function RoundView({ countdown = true, ...props }: RoundViewProps) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[props.gameId]
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
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
          const { width: w, height: h } = e.nativeEvent.layout
          setSize((prev) => prev ?? { width: w, height: h })
        }}
      >
        {size === null ? null : counting ? (
          <>
            <HudShell gameId={props.gameId} caption={props.caption} />
            <Countdown goLabel={t('play.go')} onDone={() => setCounting(false)} />
          </>
        ) : (
          <Round {...props} width={size.width} height={size.height} theme={theme} />
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
  height,
  theme,
  timeBudgetMs,
}: RoundViewProps & { width: number; height: number; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const screen = useWindowDimensions()
  const compact = screen.height < 700
  const boardWidth = Math.min(width - PADDING * 2, MAX_BOARD_WIDTH)
  // The board's columns from its width, its rows from the height the chrome leaves it (a portrait Flash Grid).
  const [platform] = useState(() => {
    const textScale = Math.min(HUD_SCALE, Math.max(1, screen.fontScale))
    const boardSlot = height - (compact ? CHROME_H_COMPACT : CHROME_H) - Math.round((textScale - 1) * CHROME_PER_SCALE)
    return mobilePlatform(boardWidth, Math.min(screen.width, screen.height), boardSlot)
  })
  const r = useBrainRound(gameId, platform, { timeBudgetMs })
  const qe = gameId === 'quickEye'
  const timing = useBrainStore((s) => s.progress.settings.timing)
  const centerOnly = useBrainStore((s) => s.progress.settings.centerOnly)
  const [boardHeight, setBoardHeight] = useState<number | null>(null)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<{ id: number; text: string; trial: number } | null>(null)
  const [burst, setBurst] = useState<{ id: number; ok: boolean } | null>(null)
  const [heartHit, setHeartHit] = useState(0)
  // The stop sheet is asked for, then shown once the round has paused under it (mid-flash it waits
  // for the flash to finish, so a flash is never hidden and then answered unseen).
  const [sheetWanted, setSheetWanted] = useState(false)
  const confirming = sheetWanted && r.paused
  const [ending, setEnding] = useState(false)
  const seq = useRef(0)

  // The latest round for handlers that outlive a render (back button, app state, fx).
  const live = useRef({ r, confirming: sheetWanted })
  useEffect(() => {
    live.current = { r, confirming: sheetWanted }
  })

  // Quick Eye's measured frames: what falls due then (a chip leaving, a pop ending, a notice) waits
  // until they are over. Other games are never quiet, so this runs everything at once for them.
  const held = useRef<(() => void)[]>([])
  const whenLoud = useCallback((fn: () => void) => {
    if (live.current.r.quiet) held.current.push(fn)
    else fn()
  }, [])
  useEffect(() => {
    if (r.quiet || held.current.length === 0) return
    const due = held.current
    held.current = []
    due.forEach((fn) => fn())
  }, [r.quiet])

  // ── Effects: haptics, the verdict burst, "+N", banners, hearts ─────────────
  const onFx = useCallback(
    (fx: BrainFx) => {
      // The ready cue and the flash only buzz (or not): nothing on screen changes for them.
      brainHaptic(fx, gameId)
      if (fx.kind === 'fixation' || fx.kind === 'stimulus') return
      const id = ++seq.current
      const trial = live.current.r.trialId
      if (fx.kind === 'correct') {
        // Quick Eye's own reveal shows the verdict on the field: no burst over it.
        if (gameId !== 'quickEye') setBurst({ id, ok: true })
        if (!fx.practice && fx.points > 0) setPops((p) => [...p.slice(-3), { id, text: `+${formatCount(fx.points)}` }])
        if ([5, 10, 15, 20, 30, 40, 50].includes(fx.streak)) setBanner({ id, trial, text: t('play.streakBanner', { value: fx.streak }) })
      }
      if (fx.kind === 'wrong' && gameId !== 'quickEye') setBurst({ id, ok: false })
      if ((fx.kind === 'correct' || fx.kind === 'wrong' || fx.kind === 'nearMiss') && fx.practice) {
        // The last practice trial's verdict: say the counted round starts next. (A rule card's
        // unscored trial is "practice" to the effects too, but it is not the tutorial ending.)
        const cur = live.current.r
        if (cur.result?.kind === 'practice' && cur.practiceDone >= cur.practiceTotal) setBanner({ id, trial, text: t('play.practiceDone') })
      }
      if (fx.kind === 'lifeLost') setHeartHit(id)
      if (fx.kind === 'levelUp') setBanner({ id, trial, text: gameId === 'quickEye' ? t('quickEye.speedUp') : t('play.levelUpBanner', { level: fx.level }) })
      if (fx.kind === 'roundEnd' && fx.reason !== 'stop') setEnding(true)
    },
    [gameId, t],
  )
  useBrainFx(r, onFx)

  useEffect(() => {
    if (!banner) return
    const id = banner.id
    const tm = setTimeout(() => whenLoud(() => setBanner((b) => (b?.id === id ? null : b))), 1600)
    return () => clearTimeout(tm)
  }, [banner, whenLoud])
  useEffect(() => {
    if (!burst) return
    const id = burst.id
    const tm = setTimeout(() => whenLoud(() => setBurst((b) => (b?.id === id ? null : b))), 650)
    return () => clearTimeout(tm)
  }, [burst, whenLoud])

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
    pausedForSheet.current = !cur.paused
    setSheetWanted(true)
    if (cur.canPause && !cur.paused) cur.pause()
  }, [confirmEmpty])
  useEffect(() => {
    if (sheetWanted && !r.paused && r.canPause && !r.over) r.pause()
  }, [sheetWanted, r])
  const cancelStop = useCallback(() => {
    setSheetWanted(false)
    if (pausedForSheet.current) live.current.r.resume()
    pausedForSheet.current = false
  }, [])
  const confirmStop = useCallback(() => {
    setSheetWanted(false)
    pausedForSheet.current = false
    live.current.r.stop()
  }, [])

  // Android's back button: the stop sheet (the round paused under it), never straight out. Under a
  // new-rule card it does nothing — the card holds the trial until it has been read. Over Quick
  // Eye's stage-up it closes the interstitial, as a tap would.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const { r: cur, confirming: asking } = live.current
      if (cur.stageUp) {
        cur.ackStageUp()
        return true
      }
      if (cur.intro) return true
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
      // A rule card already holds the trial with its clock stopped; it is still there on return.
      if (cur.over || cur.paused || cur.intro) return
      if (cur.canPause) cur.pause()
      else wantPause.current = true
    }
    const subs = [AppState.addEventListener('change', (state) => state !== 'active' && away())]
    // Android stays 'active' under the notification shade or a system dialog; it sends 'blur'.
    if (Platform.OS === 'android') subs.push(AppState.addEventListener('blur', away))
    // A round can start while the app is already in the background (the countdown ran out under a
    // phone call): it starts paused.
    if (AppState.currentState !== 'active') away()
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
  // Placement moves the level in big jumps while it finds the start: no number then, so the jumps
  // are not read as a score (the line keeps its room, so the board does not move when it returns).
  // Quick Eye: "Stage N · speed level L" (the trial's own stage — practice is stage 1), "top speed"
  // at the shortest flash; practice shows the stage alone, its flashes are not the player's level.
  const stage = t('quickEye.stage', { stage: r.stage ?? 1 })
  const levelText = r.placing
    ? ' '
    : qe
      ? r.speed
        ? `${stage} · ${r.speed.atTop ? t('quickEye.topSpeed') : t('quickEye.speedLevel', { level: r.speed.shown })}`
        : r.trialKind === 'practice'
          ? stage
          : `${stage} · ${t('quickEye.speedLevel', { level: qeSpeedLevel(r.level) })}`
      : t('home.level', { level: r.level.toFixed(1) })
  const result = r.result
  const qeView = r.view.kind === 'quickEye' ? r.view : null
  // Quick Eye never says "wrong": a miss at a flash this short is the game working.
  const resultText = !result
    ? null
    : result.void
      ? t('play.void')
      : result.correct
        ? t('play.correct')
        : qeView
          ? qeView.nearMiss
            ? t('quickEye.nearMiss')
            : t('quickEye.missFast')
          : result.timedOut
            ? result.livesLost === 0 && timing !== 1
              ? t('play.timeUpForgiven')
              : t('play.timeUp')
            : t('play.wrong')
  const resultColor = !result || result.void ? 'rgba(255,255,255,0.7)' : result.correct ? FX.goodText : qe ? 'rgba(255,255,255,0.88)' : FX.badText
  // Screen readers hear what the reveal shows: the centre answer and the star's side.
  const revealText =
    result && !result.void && qeView?.correctCenter !== undefined && qeView.correctDirection !== undefined
      ? t('quickEye.revealA11y', { center: centerLabel(t, qeView.centerOptions[qeView.correctCenter]), dir: t(`quickEye.dir.${qeView.correctDirection}`) })
      : null
  const resultSpoken = resultText && revealText ? `${resultText}. ${revealText}` : resultText
  const tier = streakTier(r.stats.streak)
  const capProgress = r.roundCap !== null && !r.practice && !r.placing ? r.trialInRound / r.roundCap : null
  // Quick Eye's leg: one mark per counted trial instead of a plain bar (from its first counted or rule-card trial).
  const legBar = r.maxLives === 0 && r.roundCap !== null && !r.placing && r.trialKind !== 'practice'
  const practiceCount = Math.min(r.practiceTotal, r.practiceDone + (result ? 0 : 1))
  // The quiet line under the board when nothing else is said: what kind of trial this is — or, in
  // Quick Eye's leg, how far the next speed step is ("2 more right and it gets faster").
  const hint =
    r.trialKind === 'practice'
      ? qe && r.practiceDone > 0
        ? t('quickEye.slowerStart')
        : t('play.practiceHint')
      : r.trialKind === 'intro'
        ? t('rule.unscored')
        : r.placing
          ? t('placement.hint')
          : r.speed && !r.speed.atTop
            ? t('quickEye.gauge', { count: r.speed.toNext })
            : null
  // One chip at a time, between trials: Quick Eye's lasts only as long as the reveal it came with
  // (the next trial's fixation starts before its timer runs out, and must find the screen still).
  const shownBanner = banner && (!qe || (banner.trial === r.trialId && result !== null)) ? banner : null

  // VoiceOver has no live regions: say the verdict out loud (TalkBack hears the polite region).
  useEffect(() => {
    if (Platform.OS === 'ios' && resultSpoken) AccessibilityInfo.announceForAccessibility(resultSpoken)
  }, [resultSpoken, r.trialId])

  // A bigger board's notice: shown for ~3s from the trial that brought it, then gone — its seconds
  // (and VoiceOver's announcement) counted from when a rule card on the same trial has been read,
  // not under the card. Quick Eye's (the redrawn field) opens once its first flash is over.
  const toastId = r.toast?.id ?? null
  const ruleUp = r.intro !== null
  const [toastOpen, setToastOpen] = useState<number | null>(null)
  const [toastSeen, setToastSeen] = useState<number | null>(null)
  useEffect(() => {
    if (toastId === null || ruleUp || r.quiet || toastId === toastOpen || toastId === toastSeen) return
    setToastOpen(toastId)
  }, [toastId, ruleUp, r.quiet, toastOpen, toastSeen])
  useEffect(() => {
    if (toastOpen === null || ruleUp) return
    const id = toastOpen
    const tm = setTimeout(() => whenLoud(() => setToastSeen(id)), TOAST_MS)
    return () => clearTimeout(tm)
  }, [toastOpen, ruleUp, whenLoud])
  const toast = r.toast && r.toast.id === toastOpen && !ruleUp && r.toast.id !== toastSeen && !r.over ? r.toast : null
  const toastText = toast ? { title: `${t('rule.change')} · ${t(`mechanics.${toast.copy}.title`)}`, body: t(`mechanics.${toast.copy}.body`) } : null
  const toastSpoken = toastText ? `${toastText.title}. ${toastText.body}` : null
  useEffect(() => {
    if (Platform.OS === 'ios' && toastSpoken) AccessibilityInfo.announceForAccessibility(toastSpoken)
  }, [toastSpoken])

  const covered = r.paused || confirming || ending || r.intro !== null || r.stageUp !== null

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
            <Text
              style={[styles.level, { color: theme.accent }]}
              numberOfLines={1}
              maxFontSizeMultiplier={HUD_SCALE}
              accessibilityElementsHidden={r.placing}
              importantForAccessibility={r.placing ? 'no' : 'auto'}
              testID="brain-level"
            >
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

        {/* Score, run and chances — then the round's bars; a board notice lies over both for a moment. */}
        <View>
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
                <ScorePop key={p.id} text={p.text} color={theme.accent} onDone={() => whenLoud(() => setPops((list) => list.filter((x) => x.id !== p.id)))} />
              ))}
            </View>

            {tier > 0 && !r.practice ? (
              <Streak
                tier={tier}
                streak={r.stats.streak}
                label={t('play.streakCount', { value: r.stats.streak })}
                narrow={screen.width < 400 || r.maxLives > 3 || r.placing}
              />
            ) : (
              <View />
            )}

            {/* Chances — or, while none can be lost, a pill saying why: practice, a new rule, placement. */}
            {r.trialKind === 'practice' ? (
              <HudPill text={t('play.practice', { done: practiceCount, total: r.practiceTotal })} testID="brain-lives" />
            ) : r.trialKind === 'intro' ? (
              <HudPill icon="info" text={t('rule.label')} testID="brain-rule-pill" />
            ) : r.placing ? (
              <HudPill icon="compass" text={qe ? t('quickEye.warmup') : t('placement.label')} testID="brain-placement-pill" />
            ) : r.maxLives === 0 ? (
              // No chances to show (Quick Eye): its speed gauge takes their place.
              r.speed ? (
                <SpeedGauge
                  pips={r.speed.pips}
                  top={r.speed.atTop ? (r.hold ? t('quickEye.hold', { n: r.hold.filled }) : t('quickEye.topSpeed')) : null}
                  label={t('quickEye.gauge', { count: r.speed.toNext })}
                  accent={theme.accent}
                />
              ) : (
                <View />
              )
            ) : (
              <Hearts lives={liveLives} max={r.maxLives} hit={heartHit} label={t(r.group === 'span' ? 'play.livesSpan' : 'play.lives', { value: liveLives })} />
            )}
          </View>

          {/* The round's progress (capped rounds), then this trial's clock. */}
          <View style={[styles.bars, compact && styles.barsCompact]}>
            {/* Its room is kept during practice too, so the board does not resize when practice ends. */}
            {legBar ? (
              <LegBar marks={r.legMarks} cap={r.roundCap ?? 0} label={t('play.trial', { done: r.trialInRound, total: r.roundCap ?? 0 })} />
            ) : capProgress !== null ? (
              <CapBar progress={capProgress} now={r.trialInRound} max={r.roundCap ?? 0} label={t('play.trial', { done: r.trialInRound, total: r.roundCap ?? 0 })} />
            ) : r.roundCap !== null ? (
              <View style={styles.capSpacer} />
            ) : null}
            <TimerBar key={r.trialId} timer={r.timer} accent={theme.accent} />
          </View>
          {toast && toastText ? <BoardNotice key={toast.id} title={toastText.title} body={toastText.body} theme={theme} /> : null}
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
                // Sibling keys share one namespace: trial ids and effect ids both count from 1.
                key={`board-${r.trialId}`}
                view={r.view}
                onTap={r.tap}
                onExposure={r.reportExposure}
                onSkipReveal={r.skipReveal}
                width={boardWidth}
                height={boardHeight}
                theme={theme}
                // A rule card or a stage-up holds the trial as a pause does (Quick Eye stops counting frames).
                paused={r.paused || r.intro !== null || r.stageUp !== null}
              />
            )}
            {/* The verdict, big and brief, over the board. */}
            {burst ? <Burst key={`burst-${burst.id}`} ok={burst.ok} /> : null}
          </View>
          <View style={[styles.resultRow, compact && styles.resultRowCompact]} accessibilityLiveRegion="polite" pointerEvents="none">
            {shownBanner ? (
              <BannerPill key={shownBanner.id} text={shownBanner.text} />
            ) : result && resultText ? (
              <ResultLine key={r.trialId} text={resultText} spoken={resultSpoken ?? resultText} color={resultColor} />
            ) : hint ? (
              <Text style={styles.hint} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={HUD_SCALE} testID="brain-hint">
                {hint}
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

      {r.intro && !ending ? <RuleCard key={r.intro.tag} copy={r.intro.copy} theme={theme} onAck={r.ackIntro} /> : null}

      {/* Over the rule card when one follows: the stage first, then what its new rule means. */}
      {r.stageUp && !ending ? (
        <StageUpInterstitial key={r.stageUp.id} up={r.stageUp} centerOnly={centerOnly} width={width} theme={theme} onAck={r.ackStageUp} />
      ) : null}

      {ending ? (
        <RoundOver
          endedBy={r.stats.endedBy}
          // A Quick Eye leg is finished, not "cleared": it has no chances to keep.
          cleared={r.stats.cleared && !qe}
          clearedLabel={t('play.roundCleared')}
          over={
            r.stats.endedBy === 'void'
              ? t('summary.voided')
              : r.stats.endedBy === 'time'
                ? t('play.timeUp')
                : qe
                  ? t('quickEye.legEnd')
                  : t('play.roundOver')
          }
          theme={theme}
        />
      ) : null}
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
  // Room for two lines at the text size actually used (system scaling up to HUD_SCALE), so a
  // two-line prompt never pushes the board down mid-round.
  const { fontScale } = useWindowDimensions()
  const scale = Math.min(HUD_SCALE, Math.max(1, fontScale))
  return (
    <View style={[styles.promptBox, compact && styles.promptBoxCompact, { minHeight: Math.round((compact ? 44 : 50) * scale) }]} pointerEvents="none">
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

/** `spoken` may say more than the line shows (Quick Eye adds where the star was). */
function ResultLine({ text, spoken, color }: { text: string; spoken: string; color: string }) {
  const rise = useMotion('rise', text)
  return (
    <Animated.Text
      style={[styles.result, { color }, rise]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      maxFontSizeMultiplier={HUD_SCALE}
      accessibilityLabel={spoken}
      testID="brain-result"
    >
      {text}
    </Animated.Text>
  )
}

/** A centre answer as spoken: "circle", "square", "same", "different". */
function centerLabel(t: (key: string) => string, opt: string | undefined): string {
  if (opt === 'same' || opt === 'different') return t(`quickEye.${opt}`)
  return t(opt === 'circle' ? 'quickEye.circle' : 'quickEye.square')
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

function Streak({ tier, streak, label, narrow }: { tier: number; streak: number; label: string; narrow: boolean }) {
  const pop = useMotion('pop', tier)
  const bg = tier >= 3 ? '#F97316' : tier === 2 ? 'rgba(251,146,60,0.9)' : 'rgba(255,255,255,0.14)'
  return (
    <Animated.View
      style={[styles.streak, { backgroundColor: bg }, tier >= 3 && styles.streakHot, pop]}
      accessible
      accessibilityLabel={label}
      testID="brain-streak"
    >
      <Feather name="zap" size={18} color="#FFFFFF" />
      {/* A narrow phone (or five hearts beside it) gets the flame and the number only. */}
      <Text style={styles.streakText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {narrow ? streak : label}
      </Text>
      {narrow ? null : (
        <Text style={styles.streakMult} maxFontSizeMultiplier={1.2}>
          ×{comboMultiplier(streak)}
        </Text>
      )}
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

/** "Cleared" is the engine's word (the cap reached with at least half right), not just the cap. */
function RoundOver({ endedBy, cleared, clearedLabel, over, theme }: { endedBy: RoundStats['endedBy']; cleared: boolean; clearedLabel: string; over: string; theme: GameTheme }) {
  const pop = useMotion('pop', endedBy)
  const rise = useMotion('rise', endedBy)
  return (
    <CanvasOverlay testID="brain-round-over" theme={theme}>
      <Animated.View style={[styles.stamp, pop]}>
        {cleared ? (
          <Feather name="award" size={48} color={FX.gold} />
        ) : endedBy === 'lives' ? (
          <Feather name="heart" size={48} color={FX.heart} />
        ) : (
          <Feather name="flag" size={48} color="#FFFFFF" />
        )}
      </Animated.View>
      <Animated.Text style={[styles.overlayTitle, rise]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {cleared ? clearedLabel : over}
      </Animated.Text>
    </CanvasOverlay>
  )
}

/** In the hearts' place while no chance can be lost: practice, a rule's trial, placement. */
function HudPill({ text, icon, testID }: { text: string; icon?: FeatherName; testID: string }) {
  return (
    <View style={styles.practicePill} accessible accessibilityLabel={text} testID={testID}>
      {icon ? <Feather name={icon} size={15} color="#FFFFFF" /> : null}
      <Text style={styles.practiceText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={HUD_SCALE}>
        {text}
      </Text>
    </View>
  )
}

/**
 * A bigger board's notice — "What's new · Bigger grid" and its line — laid over the score row and
 * the bars for a moment. It never moves the board, never covers the prompt or a tile, and never
 * takes a touch.
 */
function BoardNotice({ title, body, theme }: { title: string; body: string; theme: GameTheme }) {
  const pop = useMotion('pop', title)
  return (
    <View pointerEvents="none" style={styles.noticeWrap} accessibilityLiveRegion="polite" testID="brain-board-notice">
      <Animated.View style={[styles.notice, { borderColor: theme.accent }, pop]} accessible accessibilityLabel={`${title}. ${body}`}>
        <Text style={[styles.noticeTitle, { color: theme.cardFrom }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15}>
          {title}
        </Text>
        <Text style={styles.noticeBody} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15}>
          {body}
        </Text>
      </Animated.View>
    </View>
  )
}

/**
 * A rule the player has not met yet: a white card over the board, which holds the trial with its
 * clock stopped until "Got it". The trial after it is unscored (the card says so). The pause
 * button is off meanwhile, and Android's back button waits for the card.
 */
function RuleCard({ copy, theme, onAck }: { copy: string; theme: GameTheme; onAck: () => void }) {
  const { t } = useTranslation('brain')
  const pop = useMotion('pop', copy)
  const title = useRef<React.ComponentRef<typeof Text>>(null)
  // Screen readers start on the card's title, not wherever they were on the board.
  useEffect(() => {
    const tm = setTimeout(() => {
      if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus')
    }, 350)
    return () => clearTimeout(tm)
  }, [copy])
  return (
    <CanvasOverlay testID="brain-rule-card" theme={theme}>
      <ScrollView style={styles.ruleScroll} contentContainerStyle={styles.ruleScrollContent} showsVerticalScrollIndicator={false} bounces={false}>
        <Animated.View style={[styles.ruleCard, pop]}>
          <View style={[styles.ruleLabel, { backgroundColor: theme.accent }]}>
            <Feather name="info" size={14} color={CANVAS_INK} />
            <Text style={styles.ruleLabelText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {t('rule.label')}
            </Text>
          </View>
          <Text ref={title} style={styles.ruleTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            {t(`mechanics.${copy}.title`)}
          </Text>
          <Text style={styles.ruleBody} maxFontSizeMultiplier={1.4}>
            {t(`mechanics.${copy}.body`)}
          </Text>
          <Text style={styles.ruleNote} maxFontSizeMultiplier={1.4}>
            {t('rule.unscored')}
          </Text>
          <Pressable
            onPress={() => {
              haptics.tap()
              onAck()
            }}
            style={({ pressed }) => [styles.ruleButton, { backgroundColor: theme.cardFrom }, pressed && styles.ruleButtonPressed]}
            accessibilityRole="button"
            testID="brain-rule-ok"
          >
            <Text style={styles.ruleButtonText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
              {t('rule.gotIt')}
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </CanvasOverlay>
  )
}

function CapBar({ progress, now, max, label }: { progress: number; now: number; max: number; label: string }) {
  const k = useSharedValue(progress)
  useEffect(() => {
    k.value = withTiming(progress, { duration: 300 })
    // `k` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, k.value) }] }))
  return (
    <View style={styles.capTrack} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now }}>
      <Animated.View style={[styles.capFill, fill]} />
    </View>
  )
}

/**
 * Quick Eye's leg: a cell per counted trial — full when both answers were right, half for one,
 * outlined for neither — never red. The next cell is a shade lighter, so the place in the leg shows.
 */
function LegBar({ marks, cap, label }: { marks: LegMark[]; cap: number; label: string }) {
  return (
    <View style={styles.leg} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: cap, now: marks.length }} testID="brain-qe-leg">
      {Array.from({ length: cap }, (_, i) => {
        const mark = marks[i]
        return (
          <View key={i} style={[styles.legCell, i === marks.length && styles.legNext, mark === 'miss' && styles.legMiss]}>
            {mark === 'ok' ? <View style={styles.legFull} /> : mark === 'half' ? <View style={styles.legHalf} /> : null}
          </View>
        )
      })}
    </View>
  )
}

/**
 * Quick Eye's speed gauge, in the hearts' place: four pips — a right answer fills one (two while the
 * game is still unsure of the player's level) and a full row makes the flash one step shorter. At
 * the shortest flash the row gives way to "hold top speed n/14", the stage's other way through.
 */
function SpeedGauge({ pips, top, label, accent }: { pips: number; top: string | null; label: string; accent: string }) {
  if (top !== null) return <HudPill icon="zap" text={top} testID="brain-qe-speed" />
  return (
    <View
      style={styles.pips}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: QE_PIPS.length, now: pips }}
      testID="brain-qe-speed"
    >
      {QE_PIPS.map((i) => (
        <Pip key={i} on={i < pips} accent={accent} />
      ))}
    </View>
  )
}

const QE_PIPS = [0, 1, 2, 3]

function Pip({ on, accent }: { on: boolean; accent: string }) {
  const pop = useMotion(on ? 'pop' : null, on)
  return <Animated.View style={[styles.pip, on && { backgroundColor: accent, borderColor: accent }, pop]} />
}

const noop = () => {}

/**
 * Quick Eye reached a new stage, between trials, the round paused under it: the stage's number
 * landing, the one new thing it brings, why the first flashes are a little slower again, and a
 * faint still of its field. It goes by itself after 2s (the engine's clock) or on a tap anywhere.
 * When a new rule's card follows there is no preview — the card shows and explains the change.
 */
function StageUpInterstitial({ up, centerOnly, width, theme, onAck }: { up: StageUp; centerOnly: boolean; width: number; theme: GameTheme; onAck: () => void }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const stamp = useSharedValue(reduced ? 1 : 1.15)
  useEffect(() => {
    if (!reduced) stamp.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) })
    // Once per stage-up (it is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const stampStyle = useAnimatedStyle(() => ({ transform: [{ scale: stamp.value }] }))
  const rise = useMotion('rise', up.id)
  const preview = useMemo<QuickEyeView | null>(() => {
    if (up.ruleFollows) return null
    const flash = buildDemo('quickEye', { variant: up.variant, centerOnly }).find((f) => f.flash)?.view
    return flash?.kind === 'quickEye' ? flash : null
  }, [up.ruleFollows, up.variant, centerOnly])
  const size = Math.max(140, Math.min(200, width - 96))
  const title = useRef<React.ComponentRef<typeof Text>>(null)
  // Screen readers start on the title, not wherever they were on the board.
  useEffect(() => {
    const tm = setTimeout(() => {
      if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus')
    }, 350)
    return () => clearTimeout(tm)
  }, [])
  return (
    <CanvasOverlay testID="brain-qe-stage-up" theme={theme}>
      {/* A tap anywhere goes on; the button is there for the eye and for screen readers. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onAck} accessible={false} importantForAccessibility="no" />
      <Animated.View style={[styles.stageUp, rise]} pointerEvents="box-none">
        <Text ref={title} style={styles.stageUpTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {t('quickEye.stageUp.title')}
        </Text>
        <Animated.View style={[styles.stageStamp, stampStyle]}>
          <Text style={styles.stageStampText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.3}>
            {t('quickEye.stageUp.stage', { stage: up.to })}
          </Text>
        </Animated.View>
        {up.knob ? (
          <Text style={styles.stageKnob} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}>
            {t(`quickEye.knob.${up.knob}`)}
          </Text>
        ) : null}
        {preview ? (
          <View style={{ opacity: PREVIEW_OPACITY }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <BrainBoard view={preview} onTap={noop} onExposure={noop} width={size} height={size} theme={theme} demo />
          </View>
        ) : null}
        <Text style={styles.stageEase} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}>
          {t('quickEye.stageUp.ease')}
        </Text>
        <CanvasButton label={t('quickEye.stageUp.continue')} onPress={onAck} theme={theme} testID="brain-qe-stage-continue" style={styles.sheetButton} />
      </Animated.View>
    </CanvasOverlay>
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
  practicePill: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 1,
  },
  practiceText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  noticeWrap: { position: 'absolute', top: 0, left: PADDING, right: PADDING, alignItems: 'center', zIndex: 5, elevation: 5 },
  notice: {
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 1,
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
  },
  noticeTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  noticeBody: { color: '#334155', fontSize: 13, lineHeight: 17 },
  ruleScroll: { width: '100%', maxWidth: 420, flexGrow: 0 },
  ruleScrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  ruleCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 22, gap: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.45)' },
  ruleLabel: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  ruleLabelText: { color: CANVAS_INK, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  ruleTitle: { color: CANVAS_INK, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.3 },
  ruleBody: { color: '#334155', fontSize: 17, lineHeight: 25 },
  ruleNote: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  ruleButton: { minHeight: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 6 },
  ruleButtonPressed: { transform: [{ scale: 0.97 }] },
  ruleButtonText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  hearts: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heart: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  bars: { paddingHorizontal: PADDING, paddingTop: 8, gap: 6 },
  barsCompact: { paddingTop: 6 },
  capSpacer: { height: 6 },
  capTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  capFill: { height: 6, width: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)', transformOrigin: 'left' },
  // The leg is as tall as the plain bar it replaces, so the board keeps its place.
  leg: { flexDirection: 'row', gap: 3, height: 6 },
  legCell: { flex: 1, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  legNext: { backgroundColor: 'rgba(255,255,255,0.26)' },
  legMiss: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  legFull: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  legHalf: { width: '50%', height: '100%', backgroundColor: 'rgba(255,255,255,0.85)' },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.10)' },
  pip: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.45)' },
  stageUp: { width: '100%', maxWidth: 360, alignItems: 'center', gap: 14, paddingHorizontal: 12 },
  stageUpTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  stageStamp: {
    minWidth: 112,
    height: 112,
    borderRadius: 56,
    paddingHorizontal: 14,
    borderWidth: 3,
    borderColor: QE_WARM,
    backgroundColor: 'rgba(242,196,107,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 32px rgba(242,196,107,0.45)`,
  },
  stageStampText: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  stageKnob: { color: '#FFFFFF', fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
  stageEase: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
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
