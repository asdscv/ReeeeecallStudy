import {
  TIER_COUNT,
  brainGame,
  gameProgress,
  tierProgress,
  type BrainGameId,
  type BrainMeta,
  type BrainProgress,
} from '@reeeeecall/shared/lib/brain-games'

/**
 * How the screens show a game's tier: per game only, never summed or averaged across games
 * (EVIDENCE #25, #27).
 */

/** The value a game's tiers are measured on (speed games their estimate, span games the length passed twice). */
export function tierValue(gameId: BrainGameId, meta: BrainMeta, progress: BrainProgress): number {
  if (brainGame(gameId).group === 'span') return meta.span2[gameId] ?? 0
  // An unfinished placement's estimate (n 0) is a guess in progress, not a standing: no progress yet.
  const est = meta.sk[gameId]
  return est ? (est.n > 0 ? est.mu : 0) : gameProgress(progress, gameId).level
}

export interface TierStanding {
  /** The best tier reached, 0 (none yet) to 6 — sticky, never lowered. */
  tier: number
  /** Toward the next tier, 0-1 (1 at the top). */
  frac: number
  /** At the top tier: nothing further to show. */
  max: boolean
}

/**
 * Where a game stands: the sticky tier, and the bar toward the next one. A value that has fallen
 * below the sticky tier (days away) shows the bar empty rather than a tier lost.
 */
export function tierStanding(gameId: BrainGameId, meta: BrainMeta, progress: BrainProgress): TierStanding {
  const tier = Math.max(0, Math.min(TIER_COUNT, meta.tier[gameId] ?? 0))
  if (tier >= TIER_COUNT) return { tier, frac: 1, max: true }
  const p = tierProgress(gameId, tierValue(gameId, meta, progress))
  const frac = p.tier === tier ? p.frac : p.tier < tier ? 0 : 1
  return { tier, frac, max: false }
}

/** Each tier's look: chip fill, its ink, and one solid colour for bars and confetti. Index 0 = no tier yet. */
export const TIER_LOOK: readonly { bg: string; fg: string; solid: string }[] = [
  { bg: 'rgba(255,255,255,0.16)', fg: '#FFFFFF', solid: 'rgba(255,255,255,0.7)' },
  { bg: 'linear-gradient(135deg,#FCD9B8 0%,#C27C4A 100%)', fg: '#3B1D06', solid: '#E0A374' },
  { bg: 'linear-gradient(135deg,#F8FAFC 0%,#A8B4C4 100%)', fg: '#1E293B', solid: '#CBD5E1' },
  { bg: 'linear-gradient(135deg,#FEF3C7 0%,#F5B400 100%)', fg: '#422006', solid: '#FCD34D' },
  { bg: 'linear-gradient(135deg,#E0FFF8 0%,#5EE0C8 100%)', fg: '#0F3D36', solid: '#5EEAD4' },
  { bg: 'linear-gradient(135deg,#E0E7FF 0%,#7C9CFF 100%)', fg: '#1E1B4B', solid: '#A5B4FC' },
  { bg: 'linear-gradient(135deg,#FDE2F3 0%,#C084FC 55%,#F472B6 100%)', fg: '#3B0764', solid: '#E9A8F5' },
]

export function tierLook(tier: number) {
  return TIER_LOOK[Math.max(0, Math.min(TIER_COUNT, tier))]
}
