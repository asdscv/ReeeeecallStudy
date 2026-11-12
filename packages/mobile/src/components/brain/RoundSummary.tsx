import { useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import {
  GAME_THEMES,
  brainGame,
  displayLevel,
  gameHistory,
  quickEyeMaxLevel,
  quickEyeMsAt,
  roundStars,
  type BrainGameId,
  type GameTheme,
} from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { CanvasButton, Confetti, GameCanvas, StatTile, useCountUp } from './GameCanvas'
import { Sparkline } from './Sparkline'
import { useMotion } from './motion'
import { FX, clock } from './brain-ui'

/** Quick Eye's levels are flash times on the 33ms floor the phone uses (mobilePlatform). */
const QE_FLOOR_MS = 33

/**
 * The end of a free-practice round, on the game's canvas: stars for how the round went, the score
 * counting up, the level it moved to, a personal best when there is one, and the recent trend.
 * The level is this game's record only, never a measure of memory (the copy says so).
 */
export function RoundSummary({ gameId, stats, onAgain, onHome }: { gameId: BrainGameId; stats: RoundStats; onAgain: () => void; onHome: () => void }) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const history = useBrainStore((s) => s.history)
  const best = useBrainStore((s) => s.progress.bestRuns[gameId])
  const trend = gameHistory(history, gameId)
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  const stars = roundStars(stats.trials, stats.correct)
  const score = useCountUp(stats.points)
  const title = stats.endedBy === 'cap' ? t('summary.cleared') : stats.endedBy === 'stop' ? t('summary.stopped') : t('summary.livesOut')
  // Quick Eye's level is its flash time: shorter is better.
  const qe = gameId === 'quickEye'
  const from = qe ? quickEyeMsAt(stats.levelStart, QE_FLOOR_MS) : displayLevel(stats.levelStart)
  const to = qe ? quickEyeMsAt(stats.levelEnd, QE_FLOOR_MS) : displayLevel(stats.levelEnd)
  const seconds = Math.round(stats.activeMs / 1000)
  const titleIn = useMotion('rise', title)

  return (
    <GameCanvas theme={theme} testID="brain-summary">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Text style={[styles.game, { color: theme.accent }]} maxFontSizeMultiplier={1.4}>
            {t(`games.${gameId}.name`)}
          </Text>
          <Animated.Text style={[styles.title, titleIn]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
            {title}
          </Animated.Text>
        </View>

        {stars > 0 ? (
          <View style={styles.stars} accessible accessibilityRole="image" accessibilityLabel={t('summary.stars', { value: stars })}>
            {[0, 1, 2].map((i) => (
              <StarGlyph key={i} lit={i < stars} big={i === 1} delay={450 + i * 220} />
            ))}
          </View>
        ) : null}

        <View style={styles.scoreBlock}>
          <Text
            style={[styles.score, { textShadowColor: theme.glow }]}
            maxFontSizeMultiplier={1.15}
            adjustsFontSizeToFit
            numberOfLines={1}
            accessibilityLabel={`${t('summary.points')} ${formatCount(stats.points)}`}
            testID="brain-summary-score"
          >
            {formatCount(score)}
          </Text>
          <Text style={styles.scoreLabel} maxFontSizeMultiplier={1.3}>
            {t('summary.points')}
          </Text>
          {/* Compared only with the player's own past — and never in red. */}
          {!stats.isNewBest && best !== undefined && best > stats.points ? (
            <Text style={styles.record} maxFontSizeMultiplier={1.4} testID="brain-summary-best">
              {t('home.record', { value: formatCount(best) })}
            </Text>
          ) : null}
        </View>

        {stats.isNewBest ? <NewBest label={t('summary.newBest')} /> : null}

        {stats.trials > 0 ? <LevelCard from={from} to={to} qe={qe} qeLevel={stats.levelEnd} span={brainGame(gameId).group === 'span'} theme={theme} /> : null}

        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <StatTile icon="list" label={t('summary.trials')} value={formatCount(stats.trials)} />
            <StatTile icon="target" label={t('summary.accuracy')} value={`${formatCount(accuracy)}%`} />
          </View>
          <View style={styles.gridRow}>
            <StatTile icon="zap" label={t('summary.bestStreak')} value={formatCount(stats.bestStreak)} />
            <StatTile icon="clock" label={t('summary.time')} value={clock(seconds)} />
          </View>
        </View>

        {trend.length >= 2 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Feather name="trending-up" size={16} color="rgba(255,255,255,0.8)" />
              <Text style={styles.cardLabel} maxFontSizeMultiplier={1.4}>
                {t('summary.trend')}
              </Text>
            </View>
            <Sparkline values={trend.map((h) => h.level)} color={theme.accent} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <CanvasButton icon="rotate-ccw" label={t('summary.again')} onPress={onAgain} theme={theme} testID="brain-again" />
          <CanvasButton icon="grid" label={t('summary.otherGames')} onPress={onHome} theme={theme} variant="glass" testID="brain-summary-home" />
        </View>
      </ScrollView>
      {stats.isNewBest ? <Confetti colors={[FX.gold, theme.accent, '#FFFFFF', FX.heart, FX.goodText]} /> : null}
    </GameCanvas>
  )
}

/** A filled ★ glyph (Feather's star is outline-only); the lit ones land one after another. */
function StarGlyph({ lit, big, delay }: { lit: boolean; big: boolean; delay: number }) {
  const pop = useMotion(lit ? 'pop' : null, lit, delay)
  return (
    <Animated.Text
      style={[styles.star, big ? styles.starBig : null, lit ? styles.starLit : styles.starDim, pop]}
      allowFontScaling={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      ★
    </Animated.Text>
  )
}

function NewBest({ label }: { label: string }) {
  const pop = useMotion('pop', label)
  return (
    <Animated.View style={[styles.best, pop]} testID="brain-new-best">
      <Feather name="award" size={20} color="#0F172A" />
      <Text style={styles.bestText} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Animated.View>
  )
}

function LevelCard({ from, to, qe, qeLevel, span, theme }: { from: number; to: number; qe: boolean; qeLevel: number; span: boolean; theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const reduced = useReducedMotion()
  const up = qe ? to < from : to > from
  const fmt = (v: number) => (qe ? `${formatCount(v)}ms` : v.toFixed(1))
  // Where in the current whole level the player now stands (Quick Eye: how far down its ladder).
  const frac = qe ? qeLevel / quickEyeMaxLevel(QE_FLOOR_MS) : to - Math.floor(to)
  const k = useSharedValue(reduced ? frac : 0)
  useEffect(() => {
    k.value = reduced ? frac : withTiming(frac, { duration: 900, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })
    // `k` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frac, reduced])
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.04, Math.min(1, k.value)) }] }))
  return (
    <View style={styles.card} accessible accessibilityLabel={`${qe ? t('intro.speed') : t('intro.level')} ${fmt(from)} → ${fmt(to)}${up ? `. ${t('summary.improved')}` : ''}`} testID="brain-summary-level">
      <View style={styles.levelHead}>
        <Text style={styles.cardLabel} maxFontSizeMultiplier={1.4}>
          {qe ? t('intro.speed') : t('intro.level')}
        </Text>
        <Text style={styles.levelValue} maxFontSizeMultiplier={1.3}>
          {fmt(from)} <Text style={styles.arrow}>→</Text> <Text style={{ color: up ? FX.goodText : '#FFFFFF' }}>{fmt(to)}</Text>
        </Text>
      </View>
      {/* Span games move a whole length at a time: no "part-way" bar for them. */}
      {!span ? (
        <View style={styles.levelTrack}>
          <Animated.View style={[styles.levelFill, { backgroundColor: theme.accent }, fill]} />
        </View>
      ) : null}
      {up ? (
        <Text style={styles.improved} maxFontSizeMultiplier={1.4}>
          {t('summary.improved')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 18, width: '100%', maxWidth: 480, alignSelf: 'center' },
  head: { alignItems: 'center', gap: 6 },
  game: { fontSize: 16, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', textAlign: 'center' },
  stars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  star: { fontSize: 48, lineHeight: 56, textAlign: 'center' },
  starBig: { fontSize: 64, lineHeight: 72, marginBottom: 8 },
  starLit: { color: FX.gold, textShadowColor: 'rgba(253,230,138,0.7)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } },
  starDim: { color: 'rgba(255,255,255,0.2)' },
  scoreBlock: { alignItems: 'center' },
  // A small glow only: iOS clips a text shadow to the text's frame, and a wide one shows as a box.
  score: { color: '#FFFFFF', fontSize: 60, lineHeight: 68, fontWeight: '900', fontVariant: ['tabular-nums'], textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  scoreLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  record: { color: 'rgba(255,255,255,0.75)', fontSize: 16, marginTop: 8 },
  best: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: FX.gold },
  bestText: { color: '#0F172A', fontSize: 17, fontWeight: '800' },
  card: { borderRadius: 18, backgroundColor: FX.glass, borderWidth: 1, borderColor: FX.glassBorder, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  levelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  levelValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  arrow: { color: 'rgba(255,255,255,0.5)' },
  levelTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  levelFill: { height: 10, width: '100%', borderRadius: 5, transformOrigin: 'left' },
  improved: { color: FX.goodText, fontSize: 14, fontWeight: '600' },
  grid: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  actions: { gap: 10, paddingTop: 4 },
})
