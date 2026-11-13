import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, TIER_COUNT, displayLevel, gameHistory, gameProgress, roundStars, type BrainGameId, type GameTheme } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats, ScoreParts } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { CanvasButton, Confetti, GameCanvas, StatTile, useCountUp } from './GameCanvas'
import { Sparkline } from './Sparkline'
import { celebrateHaptic } from './fx-haptics'
import { useMotion } from './motion'
import { AchievementCard, TIER_COLORS, TierBar, TierMedal, qeSpeedLevel, tierA11y, tierName, tierStanding, type TierStanding } from './tier-ui'
import { FX, clock } from './brain-ui'

/** The score's parts, in the order the table lists them. */
const PARTS: (keyof ScoreParts)[] = ['base', 'speed', 'combo', 'clear', 'clean']

/**
 * The end of a free-practice round, on the game's canvas: stars for how the round went, the score
 * counting up, then ONE celebration — a new tier first, else achievements, else a personal best —
 * the level it moved to and the game's tier, where the points came from, and the recent trend.
 * The level and the tier are this game's record only, never a measure of memory (the copy says so).
 */
export function RoundSummary({ gameId, stats, onAgain, onHome }: { gameId: BrainGameId; stats: RoundStats; onAgain: () => void; onHome: () => void }) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const history = useBrainStore((s) => s.history)
  const progress = useBrainStore((s) => s.progress)
  const meta = useBrainStore((s) => s.meta)
  const best = progress.bestRuns[gameId]
  const trend = gameHistory(history, gameId)
  const accuracy = stats.trials > 0 ? Math.round((stats.correct / stats.trials) * 100) : 0
  const stars = roundStars(stats.trials, stats.correct)
  const score = useCountUp(stats.points)
  const title = stats.cleared
    ? t('summary.cleared')
    : stats.endedBy === 'stop'
      ? t('summary.stopped')
      : stats.endedBy === 'void'
        ? t('summary.voided')
        : t('summary.livesOut')
  const seconds = Math.round(stats.activeMs / 1000)
  const titleIn = useMotion('rise', title)
  const gameName = t(`games.${gameId}.name`)
  const played = gameProgress(progress, gameId).rounds > 0
  const standing = tierStanding(gameId, meta, progress)
  // A placement stopped part-way has no level yet — its probe levels are not progress.
  const showLevel = stats.trials > 0 && stats.placement !== 'partial'

  // One celebration per round: a tier, else achievements, else a personal best.
  const celebration = stats.tierUp ? 'tier' : stats.achievements.length > 0 ? 'achievements' : stats.isNewBest ? 'best' : null
  useEffect(() => {
    // A tier or an achievement is felt here — unless the round already buzzed for a personal best.
    if (stats.isNewBest) return
    if (celebration === 'tier' || celebration === 'achievements') celebrateHaptic()
  }, [celebration, stats.isNewBest])

  return (
    <GameCanvas theme={theme} testID="brain-summary">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Text style={[styles.game, { color: theme.accent }]} maxFontSizeMultiplier={1.4}>
            {gameName}
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
          {/* A personal best that is not this round's celebration is a line, not a second party. */}
          {stats.isNewBest && celebration !== 'best' ? (
            <View style={styles.bestLine} testID="brain-new-best">
              <Feather name="award" size={16} color={FX.gold} />
              <Text style={styles.bestLineText} maxFontSizeMultiplier={1.4}>
                {t('summary.newBest')}
              </Text>
            </View>
          ) : null}
        </View>

        {stats.tierUp ? <TierUp tier={stats.tierUp} game={gameName} /> : null}
        {celebration === 'best' ? <NewBest label={t('summary.newBest')} /> : null}

        {stats.achievements.length > 0 ? (
          <View style={styles.list}>
            {stats.achievements.map((id, i) => (
              <AchievementCard key={id} id={id} delay={stats.tierUp ? 700 + i * 160 : 300 + i * 160} />
            ))}
          </View>
        ) : null}

        {stats.suggestRelax ? <RelaxCard theme={theme} /> : null}

        {showLevel || played ? <ProgressCard gameId={gameId} stats={stats} showLevel={showLevel} standing={played ? standing : null} theme={theme} /> : null}

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

        <Breakdown parts={stats.score} total={stats.points} />

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
      {celebration === 'tier' && stats.tierUp ? (
        <Confetti colors={[TIER_COLORS[Math.min(TIER_COUNT, stats.tierUp)], FX.gold, theme.accent, '#FFFFFF']} />
      ) : celebration === 'best' ? (
        <Confetti colors={[FX.gold, theme.accent, '#FFFFFF', FX.heart, FX.goodText]} />
      ) : null}
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

/** The tier-up moment: a big medal in the tier's colour with its name, landing with a pop. */
function TierUp({ tier, game }: { tier: number; game: string }) {
  const { t } = useTranslation('brain')
  const n = Math.min(TIER_COUNT, tier)
  const name = tierName(t, n)
  const color = TIER_COLORS[n]
  const pop = useMotion('pop', n, 250)
  const rise = useMotion('rise', n, 420)
  const headline = t('tiers.up', { tier: name })
  const body = t('tiers.upBody', { game, tier: name })
  return (
    <View style={styles.tierUp} accessible accessibilityRole="header" accessibilityLabel={`${headline} ${body}`} testID="brain-tier-up">
      <Animated.View style={[styles.tierBadge, { backgroundColor: color, boxShadow: `0 0 56px ${color}` }, pop]}>
        <Feather name={n >= TIER_COUNT ? 'star' : 'award'} size={44} color="#0F172A" />
        <Text style={styles.tierBadgeName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2}>
          {name}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.tierUpText, rise]}>
        <Text style={[styles.tierUpTitle, { color }]} maxFontSizeMultiplier={1.4}>
          {headline}
        </Text>
        <Text style={styles.tierUpBody} maxFontSizeMultiplier={1.4}>
          {body}
        </Text>
      </Animated.View>
    </View>
  )
}

/**
 * Where the round left the game: the level it moved to (Quick Eye: its speed level, higher is
 * better — never a flash time), then the game's tier with the bar toward the next.
 */
function ProgressCard({
  gameId,
  stats,
  showLevel,
  standing,
  theme,
}: {
  gameId: BrainGameId
  stats: RoundStats
  showLevel: boolean
  standing: TierStanding | null
  theme: GameTheme
}) {
  const { t } = useTranslation('brain')
  const qe = gameId === 'quickEye'
  const from = qe ? qeSpeedLevel(stats.levelStart) : displayLevel(stats.levelStart)
  const to = qe ? qeSpeedLevel(stats.levelEnd) : displayLevel(stats.levelEnd)
  const up = to > from
  const fmt = (v: number) => (qe ? formatCount(v) : v.toFixed(1))
  const label = qe ? t('intro.speed') : t('intro.level')
  return (
    <View style={styles.card} testID="brain-summary-level">
      {showLevel ? (
        <View style={styles.levelBlock} accessible accessibilityLabel={`${label} ${fmt(from)} → ${fmt(to)}${up ? `. ${t('summary.improved')}` : ''}`}>
          <View style={styles.levelHead}>
            <Text style={styles.cardLabel} maxFontSizeMultiplier={1.4}>
              {label}
            </Text>
            <Text style={styles.levelValue} maxFontSizeMultiplier={1.3}>
              {fmt(from)} <Text style={styles.arrow}>→</Text> <Text style={{ color: up ? FX.goodText : '#FFFFFF' }}>{fmt(to)}</Text>
            </Text>
          </View>
          {up ? (
            <Text style={styles.improved} maxFontSizeMultiplier={1.4}>
              {t('summary.improved')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {showLevel && standing ? <View style={styles.divider} /> : null}
      {standing ? (
        <View style={styles.tierBlock} accessible accessibilityLabel={`${t('tiers.label')} ${tierA11y(t, standing)}`} testID="brain-summary-tier">
          <View style={styles.tierHead}>
            <TierMedal tier={standing.tier} size={30} />
            <View style={styles.tierNames}>
              <Text style={styles.cardLabel} maxFontSizeMultiplier={1.4}>
                {t('tiers.label')}
              </Text>
              <Text style={styles.tierName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {tierName(t, standing.tier)}
              </Text>
            </View>
            <Text style={[styles.tierNext, standing.next === null && { color: FX.gold }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {standing.next === null ? t('tiers.max') : `${t('tiers.next')} · ${tierName(t, standing.next)}`}
            </Text>
          </View>
          <TierBar frac={standing.frac} color={standing.next === null ? FX.gold : theme.accent} height={10} animate />
        </View>
      ) : null}
    </View>
  )
}

/** "Score breakdown": each non-zero part, rounded, then the total the round actually scored. */
function Breakdown({ parts, total }: { parts: ScoreParts; total: number }) {
  const { t } = useTranslation('brain')
  const rows = PARTS.map((key) => ({ key, value: Math.round(parts[key]) })).filter((row) => row.value > 0)
  if (rows.length === 0) return null
  return (
    <View style={styles.card} testID="brain-summary-breakdown">
      <View style={styles.cardHead}>
        <Feather name="bar-chart-2" size={16} color="rgba(255,255,255,0.8)" />
        <Text style={styles.cardLabel} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {t('breakdown.title')}
        </Text>
      </View>
      <View>
        {rows.map((row) => (
          <View key={row.key} style={styles.partRow} accessible accessibilityLabel={`${t(`breakdown.${row.key}`)} ${formatCount(row.value)}`}>
            <Text style={styles.partLabel} maxFontSizeMultiplier={1.4}>
              {t(`breakdown.${row.key}`)}
            </Text>
            <Text style={styles.partValue} maxFontSizeMultiplier={1.3}>
              {row.key === 'base' ? '' : '+'}
              {formatCount(row.value)}
            </Text>
          </View>
        ))}
        <View style={[styles.partRow, styles.totalRow]} accessible accessibilityLabel={`${t('breakdown.total')} ${formatCount(total)}`}>
          <Text style={styles.totalLabel} maxFontSizeMultiplier={1.4}>
            {t('breakdown.total')}
          </Text>
          <Text style={styles.totalValue} maxFontSizeMultiplier={1.3}>
            {formatCount(total)}
          </Text>
        </View>
      </View>
    </View>
  )
}

/**
 * Rounds keep ending early on chances: offer relaxed timing (1.5×) — a suggestion the player
 * takes with one tap, never applied by itself.
 */
function RelaxCard({ theme }: { theme: GameTheme }) {
  const { t } = useTranslation('brain')
  const setSettings = useBrainStore((s) => s.setSettings)
  const [on, setOn] = useState(false)
  const rise = useMotion('rise', on)
  return (
    <View style={styles.card} testID="brain-summary-relax">
      <View style={styles.cardHead}>
        <Feather name="clock" size={18} color={theme.accent} />
        <Text style={[styles.relaxText, styles.flex]} maxFontSizeMultiplier={1.4}>
          {t('relax.suggest')}
        </Text>
      </View>
      {on ? (
        <Animated.View style={[styles.relaxOn, rise]} accessible accessibilityLiveRegion="polite" accessibilityLabel={t('relax.on')}>
          <Feather name="check-circle" size={18} color={FX.goodText} />
          <Text style={styles.relaxOnText} maxFontSizeMultiplier={1.4}>
            {t('relax.on')}
          </Text>
        </Animated.View>
      ) : (
        <CanvasButton
          icon="clock"
          label={t('relax.turnOn')}
          onPress={() => {
            setSettings({ timing: 1.5 })
            setOn(true)
          }}
          theme={theme}
          variant="glass"
          testID="brain-relax-on"
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 18, width: '100%', maxWidth: 480, alignSelf: 'center' },
  flex: { flex: 1, minWidth: 0 },
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
  bestLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  bestLineText: { color: FX.gold, fontSize: 16, fontWeight: '700' },
  best: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: FX.gold },
  bestText: { color: '#0F172A', fontSize: 17, fontWeight: '800' },
  tierUp: { alignItems: 'center', gap: 14, paddingVertical: 4 },
  tierBadge: { width: 124, height: 124, borderRadius: 62, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 12, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)' },
  tierBadgeName: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  tierUpText: { alignItems: 'center', gap: 4 },
  tierUpTitle: { fontSize: 26, fontWeight: '900', textAlign: 'center' },
  tierUpBody: { color: 'rgba(255,255,255,0.85)', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  list: { gap: 10 },
  card: { borderRadius: 18, backgroundColor: FX.glass, borderWidth: 1, borderColor: FX.glassBorder, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  levelBlock: { gap: 6 },
  levelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  levelValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  arrow: { color: 'rgba(255,255,255,0.5)' },
  improved: { color: FX.goodText, fontSize: 14, fontWeight: '600' },
  divider: { height: 1, backgroundColor: FX.glassBorder, marginVertical: 2 },
  tierBlock: { gap: 10 },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tierNames: { flexShrink: 1 },
  tierName: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  tierNext: { flex: 1, textAlign: 'right', color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
  partRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  partLabel: { flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: 15 },
  partValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalRow: { borderTopWidth: 1, borderTopColor: FX.glassBorder, marginTop: 4, paddingTop: 9 },
  totalLabel: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  totalValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  relaxText: { color: '#FFFFFF', fontSize: 16, lineHeight: 23 },
  relaxOn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  relaxOnText: { color: FX.goodText, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  grid: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  actions: { gap: 10, paddingTop: 4 },
})
