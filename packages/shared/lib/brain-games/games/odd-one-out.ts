import { range } from '../rng'
import type { BrainGameDef, CellView } from '../types'

/**
 * Every cell is the same except one. Find it. Selective attention.
 *
 * Two ways to make the odd one: a look-alike symbol, or the same symbol turned a little. The
 * look-alikes come in tiers; the turn angle is continuous, so difficulty keeps rising past the
 * last tier instead of topping out.
 */
export interface OddOneOutState {
  level: number
  cols: number
  rows: number
  common: string
  odd: string
  baseRotate: number
  oddRotate: number
  oddIndex: number
  phase: 'find' | 'done'
  picked: number | null
  timedOut: boolean
  /** Look-alike tier of a symbol round (0-3); null on a rotation round. */
  tier: number | null
}

/** Pairs that look more alike the higher the tier. Letters and CJK render the same everywhere. */
const LOOKALIKES: readonly (readonly [string, string])[][] = [
  [
    ['🍎', '🍌'], ['🐶', '🐱'], ['🚗', '🚲'], ['⭐', '🌙'], ['🌸', '🍀'],
    ['⚽', '🏀'], ['🍓', '🍇'], ['🐟', '🐦'], ['🎈', '🎁'], ['🌲', '🌵'],
  ],
  [
    ['🍊', '🍑'], ['🐻', '🐨'], ['🌼', '🌻'], ['🍋', '🍈'], ['🐯', '🦁'],
    ['🐸', '🐢'], ['🍪', '🥯'], ['🚌', '🚎'], ['🍒', '🍓'], ['🐭', '🐹'],
  ],
  [
    ['😀', '😃'], ['😄', '😁'], ['🕐', '🕑'], ['🌕', '🌖'], ['📕', '📙'],
    ['🔴', '🟠'], ['🟦', '🔷'], ['😐', '😑'], ['🌑', '🌘'], ['🙂', '😊'],
  ],
  [
    ['O', 'Q'], ['b', 'd'], ['p', 'q'], ['6', '9'], ['E', 'F'], ['M', 'N'],
    ['8', 'B'], ['人', '入'], ['土', '士'], ['未', '末'], ['大', '太'], ['日', '曰'],
    ['C', 'G'], ['5', 'S'], ['u', 'v'],
  ],
]

/** Asymmetric under every rotation, so a turned copy can never look identical. */
const ROTATABLE = ['F', 'R', 'G', 'J', 'L', 'P', '4', '7', '➜', '☂', '♞', '✎']

export const oddOneOut: BrainGameDef<OddOneOutState> = {
  id: 'oddOneOut',
  create(level, rng, ctx) {
    const n = Math.min(level < 3 ? 3 : level < 7 ? 4 : level < 12 ? 5 : level < 18 ? 6 : 7, Math.max(3, ctx.maxCols))
    const rotateRound = level >= 4 && rng.chance(0.35)
    let common: string
    let odd: string
    let baseRotate = 0
    let oddRotate = 0
    let tier: number | null = null
    if (rotateRound) {
      common = odd = rng.pick(ROTATABLE)
      baseRotate = rng.pick([0, 0, 90, 180, 270])
      const angle = Math.max(12, 180 - level * 7)
      oddRotate = baseRotate + angle * (rng.chance(0.5) ? 1 : -1)
    } else {
      const top = Math.min(LOOKALIKES.length - 1, Math.floor(level / 5))
      tier = rng.int(Math.max(0, top - 1), top)
      const pair = rng.pick(LOOKALIKES[tier])
      ;[common, odd] = rng.chance(0.5) ? [pair[0], pair[1]] : [pair[1], pair[0]]
    }
    return {
      level,
      cols: n,
      rows: n,
      common,
      odd,
      baseRotate,
      oddRotate,
      oddIndex: rng.int(0, n * n - 1),
      phase: 'find',
      picked: null,
      timedOut: false,
      tier,
    }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => s.phase === 'find',
  tap: (s, i) => (s.phase === 'find' ? { ...s, picked: i, phase: 'done' } : s),
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    const correct = s.picked === s.oddIndex && !s.timedOut
    return { correct, accuracy: correct ? 1 : 0 }
  },
  // The grid tops out at 7×7 (level 18); from there the clock tightens 3% a level to a floor.
  timeLimitMs: (s) => {
    const cells = s.cols * s.rows
    return Math.round(Math.max(1800 + cells * 90, (3500 + cells * 260) * Math.pow(0.97, Math.max(0, s.level - 18))))
  },
  maxLevel: () => 50,
  view(s) {
    const cells: CellView[] = range(s.cols * s.rows).map((i) => {
      const isOdd = i === s.oddIndex
      let tone: CellView['tone'] = 'idle'
      if (s.phase === 'done') {
        if (isOdd) tone = s.picked === i ? 'correct' : 'missed'
        else if (s.picked === i) tone = 'wrong'
      }
      const rotate = isOdd ? s.oddRotate : s.baseRotate
      return { label: isOdd ? s.odd : s.common, tone, ...(rotate ? { rotate } : {}) }
    })
    return {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: s.phase !== 'find',
      prompt: { key: 'play.findOdd' },
    }
  },
  signature: (s) => `oo:${s.common}:${s.odd}:${s.oddRotate}:${s.oddIndex}`,
  solution: (s) => (s.phase === 'find' ? [s.oddIndex] : null),
  mechanics(s) {
    const tags: string[] = []
    for (let n = 4; n <= 7; n++) if (s.cols >= n) tags.push(`oddOneOut.grid${n}`)
    if (s.tier === null) tags.push('oddOneOut.rotation')
    else if (s.tier >= 1) tags.push(['', 'oddOneOut.lookalike', 'oddOneOut.nearTwin', 'oddOneOut.glyphs'][s.tier])
    return tags
  },
}
