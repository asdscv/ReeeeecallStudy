/**
 * Display and scoring. The level itself moves by the staircase in rules.ts.
 */
export const MIN_LEVEL = 1

/**
 * The level as the player sees it, to one decimal. Steps are small (+0.15 at 85%), so a whole
 * number would sit still for seven right answers in a row; "5.2 → 6.0" says the practice is moving.
 */
export function displayLevel(level: number): number {
  return Math.max(0, Math.floor(level * 10) / 10)
}

/**
 * Points for one trial: level-weighted, a bonus when faster than the player's OWN recent median
 * (never an absolute millisecond bar — choice reaction time slows with age), and a running-streak
 * bonus. A miss scores nothing but never takes points away.
 */
export function roundPoints(level: number, correct: boolean, fast: boolean, streak: number): number {
  if (!correct) return 0
  const speed = fast ? 1.25 : 1
  const combo = 1 + Math.min(streak, 10) * 0.1
  return Math.round(10 * Math.max(1, level) * speed * combo)
}

/** Median of the last `n` values (the player's recent correct reaction times). */
export function recentMedian(values: readonly number[], n = 20): number | null {
  const tail = values.slice(-n)
  if (tail.length < 5) return null
  const sorted = tail.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
