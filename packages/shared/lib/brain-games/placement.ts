/**
 * Placement — the first round of a game never played finds the player's level in about eight
 * trials instead of climbing from level 1 at +0.15 a time (a strong player used to finish a whole
 * round still ten levels below where they belong).
 *
 * ZEST (King-Smith 1994; QUEST, Watson & Pelli 1983): a posterior over the level, updated after
 * every answer with a psychometric function whose target point is the SAME accuracy the staircase
 * converges to (85% speed, 80% Quick Eye). Trials are placed on the easy side of the posterior
 * (its 30th percentile for three trials, then the 45th), never more than a few levels above the
 * last one, and spend no chances. Then the ordinary staircase takes over from the posterior mean
 * less half its spread — its equilibrium untouched.
 *
 * No result is ever announced: the screen says "finding your start" and play simply continues
 * (a "your level is 14!" reveal would be an assessment result — EVIDENCE #25).
 */
export interface PlacementState {
  lo: number
  step: number
  /** Unnormalised posterior over lo, lo + step, ... */
  post: number[]
  n: number
  last: boolean[]
  lastLevel: number | null
  maxMove: number
  minTrials: number
  maxTrials: number
  slope: number
  lapse: number
  target: number
}

export interface PlacementOptions {
  lo: number
  hi: number
  mu0: number
  sigma0: number
  target: number
  slope: number
  maxMove: number
  minTrials: number
  maxTrials: number
}

export function startPlacement(o: PlacementOptions): PlacementState {
  const step = 0.1
  const hi = Math.max(o.lo + step, o.hi)
  const count = Math.round((hi - o.lo) / step) + 1
  const post: number[] = []
  for (let i = 0; i < count; i++) {
    const x = o.lo + i * step
    // A Gaussian guess with a flat tail, so a player far above the guess can still be found.
    const gauss = Math.exp(-0.5 * ((x - o.mu0) / o.sigma0) ** 2)
    post.push(0.8 * gauss + 0.2 / count)
  }
  return { lo: o.lo, step, post, n: 0, last: [], lastLevel: null, maxMove: o.maxMove, minTrials: o.minTrials, maxTrials: o.maxTrials, slope: o.slope, lapse: 0.05, target: o.target }
}

function percentile(p: PlacementState, q: number): number {
  const total = p.post.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < p.post.length; i++) {
    acc += p.post[i]
    if (acc / total >= q) return p.lo + i * p.step
  }
  return p.lo + (p.post.length - 1) * p.step
}

/**
 * The level of the next placement trial: the posterior's 30th percentile for three trials, then the
 * 45th — the easy side, for older first-time players — but the 65th while the last three were all
 * right, so a strong player is not walked up a level at a time (simulated: a novice still lands at
 * level 3 or below nine times in ten, a level-26 player reaches ~20 instead of ~16).
 */
export function placementLevel(p: PlacementState): number {
  const hot = p.last.length === 3 && p.last.every(Boolean)
  const want = percentile(p, p.n < 3 ? 0.3 : hot ? 0.65 : 0.45)
  const capped = p.lastLevel === null ? want : Math.min(want, p.lastLevel + p.maxMove)
  return Math.round(capped * 100) / 100
}

/**
 * P(correct | trial level x, player level θ): guess γ, lapse λ, logistic of slope s, shifted so
 * that P(θ | θ) is exactly the staircase target.
 */
export function pCorrect(x: number, theta: number, guess: number, p: Pick<PlacementState, 'slope' | 'lapse' | 'target'>): number {
  const g = Math.max(0, Math.min(p.target - 0.05, guess))
  const top = 1 - g - p.lapse
  const ratio = top / (p.target - g) - 1
  const delta = -p.slope * Math.log(Math.max(1e-6, ratio))
  return g + top / (1 + Math.exp((x - theta - delta) / p.slope))
}

export function updatePlacement(p: PlacementState, level: number, correct: boolean, guess: number): PlacementState {
  const post = p.post.map((w, i) => {
    const theta = p.lo + i * p.step
    const pc = pCorrect(level, theta, guess, p)
    return w * (correct ? pc : 1 - pc)
  })
  // Keep the numbers in range.
  const max = Math.max(...post)
  const norm = max > 0 ? post.map((w) => w / max) : p.post
  return { ...p, post: norm, n: p.n + 1, last: [...p.last, correct].slice(-3), lastLevel: level }
}

/** Eight trials, longer while the last three are all right (up to the maximum). */
export function placementDone(p: PlacementState): boolean {
  if (p.n >= p.maxTrials) return true
  if (p.n < p.minTrials) return false
  return !(p.last.length === 3 && p.last.every(Boolean))
}

/** Where the staircase takes over, and how sure that is. */
export function placementResult(p: PlacementState): { level: number; sd: number } {
  const total = p.post.reduce((a, b) => a + b, 0)
  let mean = 0
  p.post.forEach((w, i) => (mean += (p.lo + i * p.step) * w))
  mean /= total
  let variance = 0
  p.post.forEach((w, i) => (variance += ((p.lo + i * p.step - mean) ** 2) * w))
  const sd = Math.sqrt(variance / total)
  return { level: Math.max(p.lo, mean - 0.5 * sd), sd }
}
