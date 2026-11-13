import { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  TIER_COUNT,
  brainGame,
  dayNumber,
  gameProgress,
  localDayKey,
  tierProgress,
  type AchievementId,
  type BrainGameId,
  type BrainMeta,
  type BrainProgress,
} from '@reeeeecall/shared/lib/brain-games'
import { useMotion } from './motion'
import { FX, type FeatherName } from './brain-ui'

/**
 * Tiers and achievements on the phone — the pieces the hub, the intro, the results and the session
 * end share. A tier is per game only (never summed, averaged or compared across games), and the
 * achievements are listed, never counted.
 */

/** Medal colours, light enough to read on every dark canvas and every hub card gradient. */
export const TIER_COLORS: Record<number, string> = {
  1: '#F0B38A',
  2: '#E2E8F0',
  3: '#FDE68A',
  4: '#99F6E4',
  5: '#BAE6FD',
  6: '#F5D0FE',
}

/** Each achievement's Feather icon (the copy is `achievements.<id>.title/body`). */
export const ACHIEVEMENT_ICONS: Record<AchievementId, FeatherName> = {
  firstClear: 'flag',
  cleanRound: 'shield',
  streak10: 'zap',
  streak20: 'activity',
  flawlessHunt: 'crosshair',
  span7: 'layers',
  allGames: 'grid',
  firstSession: 'play-circle',
  weekGoal: 'calendar',
  coreCourse: 'book-open',
  comeback: 'rotate-ccw',
  goldTier: 'award',
  masterTier: 'star',
}

export function tierName(t: TFunction, tier: number): string {
  return tier > 0 ? t(`tiers.t${Math.min(TIER_COUNT, tier)}`) : t('tiers.none')
}

/** The value a game's tier bar is read from, in the units of TIERS. */
export function tierValue(game: BrainGameId, meta: BrainMeta, progress: BrainProgress): number {
  if (brainGame(game).group === 'span') return meta.span2[game] ?? 0
  // An unfinished placement's estimate (n 0) is a guess in progress, not a standing: no progress yet.
  const est = meta.sk[game]
  return est ? (est.n > 0 ? est.mu : 0) : gameProgress(progress, game).level
}

export interface TierStanding {
  /** The sticky best tier, 0-6. */
  tier: number
  /** The tier the bar runs toward, or null at the top. */
  next: number | null
  /** 0-1 toward `next`. */
  frac: number
}

/**
 * Where a game stands: the sticky tier, and a bar toward the next one. The bar starts from the
 * sticky tier — a value that has slipped below it shows an empty bar, never a lower tier.
 */
export function tierStanding(game: BrainGameId, meta: BrainMeta, progress: BrainProgress): TierStanding {
  const sticky = Math.max(0, Math.min(TIER_COUNT, meta.tier[game] ?? 0))
  if (sticky >= TIER_COUNT) return { tier: TIER_COUNT, next: null, frac: 1 }
  const p = tierProgress(game, tierValue(game, meta, progress))
  const frac = p.tier === sticky ? p.frac : p.tier < sticky ? 0 : 1
  return { tier: sticky, next: sticky + 1, frac }
}

/** A placement game (not Match Pairs, not the span games) that will open with placement. */
export function opensWithPlacement(game: BrainGameId, meta: BrainMeta, progress: BrainProgress): boolean {
  if (game === 'pairs' || brainGame(game).group === 'span') return false
  const est = meta.sk[game]
  return (gameProgress(progress, game).rounds === 0 && !est) || (est !== undefined && est.n === 0)
}

/** Back after two weeks or more away from this game. */
export function backAfterBreak(game: BrainGameId, meta: BrainMeta): boolean {
  const est = meta.sk[game]
  return !!est && est.day > 0 && dayNumber(localDayKey()) - est.day >= 14
}

/** "Gold → Platinum" for a screen reader; the top tier says so. */
export function tierA11y(t: TFunction, s: TierStanding): string {
  return s.next === null ? `${tierName(t, s.tier)}, ${t('tiers.max')}` : `${tierName(t, s.tier)}, ${t('tiers.next')} ${tierName(t, s.next)} ${Math.round(s.frac * 100)}%`
}

/** A round medal in the tier's colour (outlined and dim before the first tier). */
export function TierMedal({ tier, size = 22 }: { tier: number; size?: number }) {
  const lit = tier > 0
  return (
    <View
      style={[
        styles.medal,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: lit ? TIER_COLORS[Math.min(TIER_COUNT, tier)] : 'transparent' },
        !lit && styles.medalNone,
      ]}
    >
      <Feather name={tier >= TIER_COUNT ? 'star' : 'award'} size={Math.round(size * 0.58)} color={lit ? '#0F172A' : 'rgba(255,255,255,0.8)'} />
    </View>
  )
}

/**
 * A progress bar toward the next tier. `animate` fills it from empty once (the results screen);
 * reduce motion shows it filled at once.
 */
export function TierBar({
  frac,
  color,
  track = 'rgba(255,255,255,0.12)',
  height = 8,
  animate = false,
  label,
}: {
  frac: number
  color: string
  track?: string
  height?: number
  animate?: boolean
  label?: string
}) {
  const reduced = useReducedMotion()
  const moving = animate && !reduced
  const k = useSharedValue(moving ? 0 : frac)
  useEffect(() => {
    k.value = moving ? withTiming(frac, { duration: 900, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }) : frac
    // `k` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frac, moving])
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.03, Math.min(1, k.value)) }] }))
  return (
    <View
      style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label !== undefined ? { min: 0, max: 100, now: Math.round(Math.max(0, Math.min(1, frac)) * 100) } : undefined}
    >
      <Animated.View style={[{ height, width: '100%', borderRadius: height / 2, backgroundColor: color, transformOrigin: 'left' }, fill]} />
    </View>
  )
}

/** One achievement just earned, on the canvas: a gold icon, "Achievement", its title and line. */
export function AchievementCard({ id, delay = 0 }: { id: AchievementId; delay?: number }) {
  const { t } = useTranslation('brain')
  const pop = useMotion('pop', id, delay)
  const title = t(`achievements.${id}.title`)
  const body = t(`achievements.${id}.body`)
  return (
    <Animated.View style={[styles.ach, pop]} accessible accessibilityLabel={`${t('achievements.earned')}: ${title}. ${body}`} testID={`brain-achievement-${id}`}>
      <View style={styles.achIcon}>
        <Feather name={ACHIEVEMENT_ICONS[id]} size={22} color="#0F172A" />
      </View>
      <View style={styles.achText}>
        <Text style={styles.achKicker} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {t('achievements.earned')}
        </Text>
        <Text style={styles.achTitle} maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
        <Text style={styles.achBody} maxFontSizeMultiplier={1.4}>
          {body}
        </Text>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  medal: { alignItems: 'center', justifyContent: 'center' },
  medalNone: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)', borderStyle: 'dashed' },
  ach: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 18, padding: 14, backgroundColor: 'rgba(253,230,138,0.10)', borderWidth: 1, borderColor: 'rgba(253,230,138,0.35)' },
  achIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: FX.gold, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(253,230,138,0.45)' },
  achText: { flex: 1, minWidth: 0, gap: 2 },
  achKicker: { color: FX.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  achTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  achBody: { color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 20 },
})
