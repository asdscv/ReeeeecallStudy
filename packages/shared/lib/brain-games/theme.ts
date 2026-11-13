import type { BrainColor, BrainGameId, SetColor } from './types'

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
  oddOneOut: { cardFrom: '#C2410C', cardTo: '#9A3412', canvasFrom: '#2A0F05', canvasTo: '#7C2D12', accent: '#FDBA74', glow: 'rgba(253,186,116,0.55)' },
  schulte: { cardFrom: '#047857', cardTo: '#065F46', canvasFrom: '#022C22', canvasTo: '#064E3B', accent: '#6EE7B7', glow: 'rgba(110,231,183,0.5)' },
  memoryGrid: { cardFrom: '#1D4ED8', cardTo: '#1E3A8A', canvasFrom: '#0B1535', canvasTo: '#1E3A8A', accent: '#93C5FD', glow: 'rgba(147,197,253,0.55)' },
  sequence: { cardFrom: '#A21CAF', cardTo: '#86198F', canvasFrom: '#2E0533', canvasTo: '#701A75', accent: '#F0ABFC', glow: 'rgba(240,171,252,0.55)' },
  series: { cardFrom: '#0F766E', cardTo: '#115E59', canvasFrom: '#032221', canvasTo: '#134E4A', accent: '#5EEAD4', glow: 'rgba(94,234,212,0.5)' },
  pairs: { cardFrom: '#BE123C', cardTo: '#9F1239', canvasFrom: '#33040F', canvasTo: '#881337', accent: '#FDA4AF', glow: 'rgba(253,164,175,0.55)' },
  stroop: { cardFrom: '#0369A1', cardTo: '#075985', canvasFrom: '#061E30', canvasTo: '#0C4A6E', accent: '#7DD3FC', glow: 'rgba(125,211,252,0.55)' },
  math: { cardFrom: '#4D7C0F', cardTo: '#3F6212', canvasFrom: '#121F04', canvasTo: '#365314', accent: '#BEF264', glow: 'rgba(190,242,100,0.5)' },
  // The thinking games (2026-11-13), on hues the first eight leave free: violet, yellow, indigo, green.
  setMatch: { cardFrom: '#6D28D9', cardTo: '#5B21B6', canvasFrom: '#1C0B3D', canvasTo: '#4C1D95', accent: '#C4B5FD', glow: 'rgba(196,181,253,0.55)' },
  codeBreak: { cardFrom: '#A16207', cardTo: '#854D0E', canvasFrom: '#241703', canvasTo: '#713F12', accent: '#FDE047', glow: 'rgba(253,224,71,0.5)' },
  makeNumber: { cardFrom: '#4338CA', cardTo: '#3730A3', canvasFrom: '#12103A', canvasTo: '#312E81', accent: '#A5B4FC', glow: 'rgba(165,180,252,0.55)' },
  mazeRun: { cardFrom: '#15803D', cardTo: '#166534', canvasFrom: '#052E16', canvasTo: '#14532D', accent: '#86EFAC', glow: 'rgba(134,239,172,0.5)' },
}

/**
 * Set Match card colours: Okabe–Ito blue, vermillion and black (Okabe & Ito 2008), on the white
 * card face `SET_CARD_FACE`. Of every Okabe–Ito colour at least 3:1 against white (WCAG 1.4.11),
 * this is the triple that stays furthest apart under colour-vision deficiency: simulated at full
 * severity for protanopia and deuteranopia (Machado 2009, Viénot 1999) and tritanopia (Machado
 * 2009), every pair is ≥ 38 CIEDE2000 apart (red against green would be under 11). Blue 5.2:1,
 * vermillion 3.9:1, black 21:1 against the card. The owner is red-green colour-blind; these were
 * chosen for everyone, not as a setting. brain-new-games.test.ts recomputes both numbers.
 */
export const SET_COLORS: Record<SetColor, string> = {
  blue: '#0072B2',
  vermillion: '#D55E00',
  black: '#000000',
}

/** The card a Set Match card is drawn on (real SET cards are white too). */
export const SET_CARD_FACE = '#FFFFFF'

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

/**
 * Colour Word inks — one palette for everyone, safe in colour-vision deficiency (owner 2026-11-13:
 * «나 적록색맹인데 색 자체가 너무 구분이 안됨»). No red, no green and no yellow: red–green pairs
 * collapse for protan and deutan players, and a yellow dark enough to read on white is a mustard
 * the same players take for orange or brown. The six are basic colour names in every locale, set
 * apart by lightness as well as hue — navy and purple, black and brown, gray and orange — so they
 * hold up in the two-dimensional (lightness × blue–yellow) colour space a dichromat sees.
 *
 * On the white stimulus card both platforms draw (and the white option tiles): every ink at least
 * 3.5:1 against white (orange 3.56:1 and purple 3.63:1 are the lowest — above the 3:1 bar for the
 * 40px+ word and the ≥ 24px bold labels), black 21:1. Okabe–Ito's own sky blue, yellow and orange
 * are 1.3–2.3:1 on white, so the palette borrows their logic, not their values.
 *
 * Every pair is at least 21 CIEDE2000 apart in normal vision and in protanopia, deuteranopia
 * (Viénot 1999 and Machado 2009 at full severity) and tritanopia (Machado 2009) — the closest pairs
 * are orange–brown (21.7, deutan) and purple–gray (22.1, tritan). brain-stroop-ladder.test.ts
 * recomputes it.
 */
export const INK_COLORS: Record<BrainColor, string> = {
  blue: '#1E3A8A',
  orange: '#EA580C',
  purple: '#B45CF5',
  black: '#000000',
  brown: '#6F2C00',
  gray: '#737373',
}

/**
 * The inks a colour-blind player could take for each other: INK_COLORS simulated for protanopia,
 * deuteranopia and tritanopia (as above), then CIEDE2000 between the simulated colours — a pair is
 * confusable below 20. With the palette above no pair is, in any simulation, so every list is
 * empty; the table stays so Colour Word's coloured labels and frame lure keep honouring it if a
 * colour is ever changed. brain-stroop-ladder.test.ts recomputes it.
 */
export const INK_CONFUSABLE: Record<BrainColor, readonly BrainColor[]> = {
  blue: [],
  orange: [],
  purple: [],
  black: [],
  brown: [],
  gray: [],
}

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
