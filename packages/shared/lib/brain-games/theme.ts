import type { BrainGameId } from './types'

/**
 * Each game's colour identity, shared by web and mobile so a game looks like itself everywhere.
 *
 * `card*` is the hub card gradient: white text on it is at least 4.5:1 (the 700-weight of each
 * hue). `canvas*` is the game screen — a deep, immersive gradient that stays dark in light mode
 * too, so tiles and flashes read the same in either theme. `accent` is the bright highlight used
 * on the canvas (progress, combo, rings): at least 7:1 against `canvasFrom`.
 */
export interface GameTheme {
  cardFrom: string
  cardTo: string
  canvasFrom: string
  canvasTo: string
  accent: string
  /** A soft glow of the accent, for shadows behind lit tiles and the score. */
  glow: string
}

export const GAME_THEMES: Record<BrainGameId, GameTheme> = {
  quickEye: { cardFrom: '#6D28D9', cardTo: '#4338CA', canvasFrom: '#1E1B4B', canvasTo: '#3B0764', accent: '#C4B5FD', glow: 'rgba(196,181,253,0.55)' },
  oddOneOut: { cardFrom: '#C2410C', cardTo: '#9A3412', canvasFrom: '#2A0F05', canvasTo: '#7C2D12', accent: '#FDBA74', glow: 'rgba(253,186,116,0.55)' },
  schulte: { cardFrom: '#047857', cardTo: '#065F46', canvasFrom: '#022C22', canvasTo: '#064E3B', accent: '#6EE7B7', glow: 'rgba(110,231,183,0.5)' },
  memoryGrid: { cardFrom: '#1D4ED8', cardTo: '#1E3A8A', canvasFrom: '#0B1535', canvasTo: '#1E3A8A', accent: '#93C5FD', glow: 'rgba(147,197,253,0.55)' },
  sequence: { cardFrom: '#A21CAF', cardTo: '#86198F', canvasFrom: '#2E0533', canvasTo: '#701A75', accent: '#F0ABFC', glow: 'rgba(240,171,252,0.55)' },
  series: { cardFrom: '#0F766E', cardTo: '#115E59', canvasFrom: '#032221', canvasTo: '#134E4A', accent: '#5EEAD4', glow: 'rgba(94,234,212,0.5)' },
  pairs: { cardFrom: '#BE123C', cardTo: '#9F1239', canvasFrom: '#33040F', canvasTo: '#881337', accent: '#FDA4AF', glow: 'rgba(253,164,175,0.55)' },
  stroop: { cardFrom: '#0369A1', cardTo: '#075985', canvasFrom: '#061E30', canvasTo: '#0C4A6E', accent: '#7DD3FC', glow: 'rgba(125,211,252,0.55)' },
  math: { cardFrom: '#4D7C0F', cardTo: '#3F6212', canvasFrom: '#121F04', canvasTo: '#365314', accent: '#BEF264', glow: 'rgba(190,242,100,0.5)' },
}

/** Today's Training, which is all of them: the app's brand blue into violet. */
export const TRAINING_THEME: GameTheme = {
  cardFrom: '#1D4ED8',
  cardTo: '#6D28D9',
  canvasFrom: '#0B1535',
  canvasTo: '#2E1065',
  accent: '#A5B4FC',
  glow: 'rgba(165,180,252,0.55)',
}

/**
 * Feedback colours on the dark canvas. Right and wrong also carry an icon (a tick, a cross) —
 * state is never colour alone (WCAG 1.4.1).
 */
export const CANVAS_TONES = {
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.78)',
  tile: 'rgba(255,255,255,0.10)',
  tileBorder: 'rgba(255,255,255,0.16)',
  tilePressed: 'rgba(255,255,255,0.18)',
  lit: '#FFFFFF',
  correct: '#22C55E',
  wrong: '#EF4444',
  done: 'rgba(255,255,255,0.05)',
} as const

/** Streak tiers for the combo badge: 3, 6 and 10 in a row. */
export function streakTier(streak: number): 0 | 1 | 2 | 3 {
  if (streak >= 10) return 3
  if (streak >= 6) return 2
  if (streak >= 3) return 1
  return 0
}

/** The combo multiplier the score already applies (adaptive.roundPoints), shown as "×1.5". */
export function comboMultiplier(streak: number): number {
  return Math.round((1 + Math.min(streak, 10) * 0.1) * 10) / 10
}

/**
 * Stars for a finished round, from its accuracy — a familiar, honest summary of how the round
 * went (it says nothing about memory or health). Rounds of fewer than five counted trials get none.
 */
export function roundStars(trials: number, correct: number): 0 | 1 | 2 | 3 {
  if (trials < 5) return 0
  const a = correct / trials
  if (a >= 0.9) return 3
  if (a >= 0.75) return 2
  return 1
}
