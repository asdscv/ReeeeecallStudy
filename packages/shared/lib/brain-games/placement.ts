import type { BrainGameId, TrialKind } from './types'
import { MECHANICS } from './mechanics'

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
  /** The evidence weight of the last answer (Number Hunt's strong pass is 2). */
  lastWeight: number
  maxMove: number
  /** A bigger step cap while the player is hot (see placementLevel); none = maxMove always. */
  hotMove?: number
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
  /**
   * The share of the prior spread flat over the whole range, so a player far above the guess can
   * still be found. Unset keeps the old prior, whose tail was only ~0.2% of its mass (Quick Eye
   * keeps it until its own plan moves).
   */
  tailMass?: number
  hotMove?: number
}

export function startPlacement(o: PlacementOptions): PlacementState {
  const step = 0.1
  const hi = Math.max(o.lo + step, o.hi)
  const count = Math.round((hi - o.lo) / step) + 1
  const gauss: number[] = []
  for (let i = 0; i < count; i++) {
    const x = o.lo + i * step
    gauss.push(Math.exp(-0.5 * ((x - o.mu0) / o.sigma0) ** 2))
  }
  const sum = gauss.reduce((a, b) => a + b, 0)
  const t = o.tailMass
  // A Gaussian guess with a flat tail. With tailMass t: (1 − t)·g/Σg + t/count — the tail really is t.
  const post = t === undefined ? gauss.map((g) => 0.8 * g + 0.2 / count) : gauss.map((g) => (1 - t) * (sum > 0 ? g / sum : 0) + t / count)
  return {
    lo: o.lo,
    step,
    post,
    n: 0,
    last: [],
    lastLevel: null,
    lastWeight: 1,
    maxMove: o.maxMove,
    hotMove: o.hotMove,
    minTrials: o.minTrials,
    maxTrials: o.maxTrials,
    slope: o.slope,
    lapse: 0.05,
    target: o.target,
  }
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
 *
 * Right after a strong pass (an answer weighted above 1 — Number Hunt's board cleared in half its
 * time) is hot too, even inside the first three trials: Number Hunt places in three boards, so it
 * can never have three right before it stops (simulated: a fast player hands over at ~13.1, not ~10).
 * `hotMove` (default: the state's) widens the step cap while hot.
 */
export function placementLevel(p: PlacementState, hotMove: number | undefined = p.hotMove): number {
  const strong = p.lastWeight > 1 && p.last.length > 0 && p.last[p.last.length - 1]
  const hot = (p.last.length === 3 && p.last.every(Boolean)) || strong
  const want = percentile(p, hot ? 0.65 : p.n < 3 ? 0.3 : 0.45)
  const move = hotMove !== undefined && hot ? Math.max(p.maxMove, hotMove) : p.maxMove
  const capped = p.lastLevel === null ? want : Math.min(want, p.lastLevel + move)
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

/**
 * One answer. `weight` scales how much it says (the likelihood is raised to it): Number Hunt counts
 * a board cleared in under half its time twice, and a timeout with most numbers found half.
 */
export function updatePlacement(p: PlacementState, level: number, correct: boolean, guess: number, weight = 1): PlacementState {
  const post = p.post.map((w, i) => {
    const theta = p.lo + i * p.step
    const pc = pCorrect(level, theta, guess, p)
    return w * (correct ? pc : 1 - pc) ** weight
  })
  // Keep the numbers in range.
  const max = Math.max(...post)
  const norm = max > 0 ? post.map((w) => w / max) : p.post
  return { ...p, post: norm, n: p.n + 1, last: [...p.last, correct].slice(-3), lastLevel: level, lastWeight: weight }
}

/** Eight trials, longer while the last three are all right (up to the maximum). */
export function placementDone(p: PlacementState): boolean {
  if (p.n >= p.maxTrials) return true
  if (p.n < p.minTrials) return false
  return !(p.last.length === 3 && p.last.every(Boolean))
}

/**
 * Where the staircase takes over (the posterior mean less `handoverK` of its spread), and how sure
 * that is. The board games hand over at 0.25: their staircase's bigger steps finish the job.
 */
export function placementResult(p: PlacementState, handoverK = 0.5): { level: number; sd: number } {
  const total = p.post.reduce((a, b) => a + b, 0)
  let mean = 0
  p.post.forEach((w, i) => (mean += (p.lo + i * p.step) * w))
  mean /= total
  let variance = 0
  p.post.forEach((w, i) => (variance += ((p.lo + i * p.step - mean) ** 2) * w))
  const sd = Math.sqrt(variance / total)
  return { level: Math.max(p.lo, mean - handoverK * sd), sd }
}

// ── how each game finds its start (GAMES_DIFFICULTY_PLAN §2.3) ───────────────

/** ZEST: the posterior search above. */
export interface ZestPlan {
  method: 'zest'
  /** Top of the search range. */
  hi: number
  minTrials: number
  maxTrials: number
  tailMass: number
  hotMove: number
  handoverK: number
  /** Number Hunt: a board's evidence is graded by how much of its time it took (useBrainRound). */
  graded?: true
}

/**
 * - zest: the placement series (8-14 trials, longer while the last three are right; Number Hunt
 *   exactly 3 boards, graded).
 * - probe: Match Pairs' ladder of up to four boards (useBrainRound).
 * - fast: the span games' fast entry — +2 per first-try pass until the first miss (useBrainRound).
 * Quick Eye keeps its own placement (useBrainRound) until its plan adopts these fixes.
 */
export type PlacementPlan = ZestPlan | { method: 'probe' } | { method: 'fast' }

const zest = (hi: number, extra: Partial<ZestPlan> = {}): ZestPlan => ({ method: 'zest', hi, minTrials: 8, maxTrials: 14, tailMass: 0.2, hotMove: 4, handoverK: 0.25, ...extra })

export const PLACEMENT: Partial<Record<BrainGameId, PlacementPlan>> = {
  math: zest(26),
  series: zest(20),
  oddOneOut: zest(24),
  stroop: zest(24),
  schulte: zest(20, { minTrials: 3, maxTrials: 3, hotMove: 5, graded: true }),
  pairs: { method: 'probe' },
  memoryGrid: { method: 'fast' },
  sequence: { method: 'fast' },
}

/** A board game's ZEST plan (a fallback for a speed game added without one). */
export function zestPlan(game: BrainGameId): ZestPlan {
  const plan = PLACEMENT[game]
  return plan && plan.method === 'zest' ? plan : zest(20)
}

// ── rule gating (replaces placementCeiling for board games; §2.4) ───────────

/** A round introduces at most this many rule cards … */
export const RULE_CARDS_PER_ROUND = 2
/** … at least this many counted trials apart. */
export const RULE_CARD_GAP = 3

/**
 * The rule tags (mechanics.ts) a new trial must not use — the game swaps in that level's non-rule
 * content at the same clock (ctx.blockRules).
 *
 * - practice and placement: every unseen rule (placement measures the level, not a rule met cold).
 * - counted (and the trial a card stops): every unseen rule but the one with the lowest `from`, so
 *   at most one new rule can appear per trial, in `from` order; and every one while this round has
 *   shown its two cards, or its last card was under three counted trials ago.
 * Retired rules are never made.
 */
export function blockedRules(
  game: BrainGameId,
  seen: (tag: string) => boolean,
  kind: TrialKind,
  cards: { shown: number; countedSinceLast: number | null },
): string[] {
  const unseen = MECHANICS.filter((m) => m.game === game && m.kind === 'rule' && !m.retired && !seen(m.tag))
  if (kind === 'practice' || kind === 'placement') return unseen.map((m) => m.tag)
  const full = cards.shown >= RULE_CARDS_PER_ROUND || (cards.countedSinceLast !== null && cards.countedSinceLast < RULE_CARD_GAP)
  const next = full ? undefined : [...unseen].sort((a, b) => a.from - b.from)[0]
  return unseen.filter((m) => m !== next).map((m) => m.tag)
}
