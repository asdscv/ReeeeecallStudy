/**
 * Set Match's (합 찾기) ladder against the owner's bar for the new games (2026-11-13, «새로운 게임은
 * 처음부터 내 피드백 수준으로 만들어라»), read off the boards themselves: level 1 is four cards and
 * one set; every level deals a harder board — more cards, fewer sets, more near-miss decoys, a set
 * with more attributes all different — or less time; colour, fill and «없음» each open on a small
 * board with a card; every board holds the set count its band promises (a «없음» board none), and
 * solution() plays a real set. Blocked rules give the stage's hardest board on a clock that keeps
 * tightening, so placement still means something; a rule a round meets above its start opens on
 * its first board.
 *
 * Then a modelled check, not measured people (EVIDENCE §4.5 — model values, to recalibrate from
 * logged times): a player finds a set pair by pair (two cards fix the third — look for it), in
 * random order, at a pace per pair that grows with the attributes and the board, overlooking the set
 * now and then and sometimes taking a near-miss for a set. Three people — a sharp adult, an average
 * 70-year-old, a slow 75-year-old — and the real round hook driven with them: the sharp adult meets
 * real challenge within about four trials after practice, the slow 75-year-old settles near 80%.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_CONTEXT,
  MECHANICS,
  TIERS,
  buildDemo,
  createRng,
  emptyHistory,
  emptyMeta,
  emptyProgress,
  maxColsFor,
  zestPlan,
  type CreateContext,
  type RecentTrial,
  type Rng,
  type SetAttribute,
  type SetCard,
  type SetMatchView,
} from '@reeeeecall/shared/lib/brain-games'
import {
  SET_MATCH_LADDER,
  SET_MATCH_MAX_LEVEL,
  SET_MATCH_RULE_START,
  brokenAttributes,
  isSet,
  setMatch,
  setMatchBand,
  setMatchBoard,
  setMatchLimitMs,
  setMatchPlan,
  setsOn,
  type SetMatchState,
} from '@reeeeecall/shared/lib/brain-games/games/set-match'
import { useBrainRound, type PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

const DESKTOP: CreateContext = DEFAULT_CONTEXT
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const NARROW: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5 }
const SCREENS = [DESKTOP, PHONE, SMALL, NARROW]
const BANDS = Array.from({ length: SET_MATCH_MAX_LEVEL }, (_, i) => i + 1)
const ATTRS: readonly SetAttribute[] = ['shape', 'count', 'color', 'fill']
const RULE_BANDS = Object.values(SET_MATCH_RULE_START) as number[]

const make = (level: number, seed: number, ctx: CreateContext = PHONE) => setMatch.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

/** Triples that fail on exactly one attribute. */
function nearMisses(cards: readonly SetCard[]): number {
  let n = 0
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) for (let k = j + 1; k < cards.length; k++) if (brokenAttributes(cards[i], cards[j], cards[k]).length === 1) n++
  return n
}

/** The attributes the set has all different. */
const spreadOf = (s: SetMatchState) => (s.set ? ATTRS.filter((a) => new Set(s.set!.map((i) => s.cards[i][a])).size === 3).length : 0)

/** A trial that follows another (for the variety and arrival rules): ctx.recent as the hook builds it. */
function after(prev: SetMatchState[], level: number): RecentTrial[] {
  return prev.slice(-2).map((s) => ({ level, ...setMatch.trialInfo!(s) }))
}

describe('Set Match: the ladder', () => {
  it('two attributes, then colour, then fill, each from four cards; then one set, «없음» from nine cards again, fifteen cards', () => {
    const rows = SET_MATCH_LADDER.map((r) => `${r.vary.length}:${r.cards}:${r.sets}${r.none ? '+none' : ''}`)
    expect(rows).toEqual([
      '2:4:1', '2:6:3', '2:6:2',
      '3:4:1', '3:6:2', '3:9:2', '3:12:4',
      '4:4:1', '4:6:1', '4:9:2', '4:12:3', '4:12:2',
      '4:12:1', '4:12:1', '4:12:1',
      '4:9:1+none', '4:12:1+none',
      ...Array(7).fill('4:15:1+none'),
    ])
    // The owner's example: a new kind of content starts at four cards and grows (4 → 6 → 9 → 12).
    expect([4, 5, 6, 7].map((b) => SET_MATCH_LADDER[b - 1].cards)).toEqual([4, 6, 9, 12])
    expect([8, 9, 10, 11].map((b) => SET_MATCH_LADDER[b - 1].cards)).toEqual([4, 6, 9, 12])
    // Rules start where the ladder says, as rule cards.
    const rules = MECHANICS.filter((m) => m.game === 'setMatch' && m.kind === 'rule').map((m) => [m.tag, m.from])
    expect(rules).toEqual([['setMatch.color', 4], ['setMatch.fill', 8], ['setMatch.none', 16]])
    expect(SET_MATCH_RULE_START).toEqual({ color: 4, fill: 8, none: 16 })
    // Tiers sit on bands where the puzzle changes, below the top.
    expect(TIERS.setMatch).toEqual([4, 8, 11, 13, 16, 18])
    expect(zestPlan('setMatch')).toMatchObject({ hi: 24, minTrials: 6, maxTrials: 10, hotAfter: 2, hotMove: 5 })
  })

  it('every level step is a harder board (more cards, fewer sets, more decoys, a wider set, empty boards) or less time — never a copy', () => {
    const decoy = { few: 0, some: 1, many: 2 }
    for (let b = 2; b <= SET_MATCH_MAX_LEVEL; b++) {
      const [a, z] = [SET_MATCH_LADDER[b - 2], SET_MATCH_LADDER[b - 1]]
      const harder = z.vary.length > a.vary.length || z.cards > a.cards || z.sets < a.sets || decoy[z.decoys] > decoy[a.decoys] || z.spread > a.spread || z.none > a.none || z.oneSet > a.oneSet
      const faster = setMatchLimitMs(b) < setMatchLimitMs(b - 1)
      expect(harder || faster || RULE_BANDS.includes(b), `band ${b - 1} → ${b}`).toBe(true)
      expect(JSON.stringify(z), `band ${b} copies ${b - 1}`).not.toBe(JSON.stringify(a))
    }
  })

  it('the clock: generous at the bottom, tightening inside every band, smooth across clock-only bands, 30 s at the top', () => {
    expect(setMatchLimitMs(1)).toBe(25_000)
    // At least 3 s a card on the shape-and-count boards even at a band's end, 7 s a card on the first colour and fill boards.
    for (const b of [1, 2, 3]) expect(setMatchLimitMs(b + 0.99) / SET_MATCH_LADDER[b - 1].cards, `L${b}`).toBeGreaterThanOrEqual(3000)
    for (const b of [4, 8]) expect(setMatchLimitMs(b) / SET_MATCH_LADDER[b - 1].cards, `L${b}`).toBeGreaterThanOrEqual(7000)
    for (const b of BANDS) {
      const steps = [0, 0.25, 0.5, 0.75, 0.99].map((f) => setMatchLimitMs(b + f))
      for (let i = 1; i < steps.length && b < SET_MATCH_MAX_LEVEL; i++) expect(steps[i], `L${b} +${i}`).toBeLessThan(steps[i - 1])
      const next = SET_MATCH_LADDER[b]
      const row = SET_MATCH_LADDER[b - 1]
      if (next && next.cards === row.cards && next.sets === row.sets && next.vary.length === row.vary.length) {
        // Same board, a tighter clock: the clock at the band's end meets the next band's.
        expect(Math.abs(setMatchLimitMs(b + 0.999) - setMatchLimitMs(b + 1)), `L${b} → ${b + 1}`).toBeLessThan(200)
      }
    }
    expect(setMatchLimitMs(SET_MATCH_MAX_LEVEL)).toBe(30_000)
    expect(setMatchLimitMs(60)).toBe(30_000)
    expect(setMatchLimitMs(Number.NaN)).toBe(25_000)
  })

  it('the board fits the screen (cards never under 56dp); a short screen keeps a row for «없음»', () => {
    expect(setMatchBoard(15, DESKTOP)).toEqual({ cards: 15, cols: 5, rows: 3 })
    expect(setMatchBoard(15, PHONE)).toEqual({ cards: 15, cols: 3, rows: 5 })
    expect(setMatchBoard(15, SMALL)).toEqual({ cards: 15, cols: 3, rows: 5 })
    expect(setMatchBoard(15, NARROW)).toEqual({ cards: 15, cols: 3, rows: 5 })
    expect(setMatchBoard(15, NARROW, true)).toEqual({ cards: 12, cols: 3, rows: 4 })
    expect(setMatchBoard(15, SMALL, true)).toEqual({ cards: 15, cols: 3, rows: 5 })
  })
})

describe('Set Match: sampled boards, band by band', () => {
  it('every band, screen and seed: distinct cards, the fixed attributes fixed, exactly the sets the band promises, and solution() plays one', () => {
    for (const ctx of SCREENS) {
      for (const b of BANDS) {
        const plan = setMatchBand(b)
        for (let seed = 1; seed <= 12; seed++) {
          const s = make(b, seed, ctx)
          const v = setMatch.view(s) as SetMatchView
          const at = `L${b} ${ctx.maxCols}x${ctx.maxRows} seed ${seed}`
          expect(v.cards.length, at).toBe(v.cols * v.rows)
          expect(new Set(v.cards.map((c) => JSON.stringify(c.card))).size, at).toBe(v.cards.length)
          for (const attr of ATTRS) if (!plan.vary.includes(attr)) expect(new Set(s.cards.map((c) => c[attr])).size, `${at} ${attr}`).toBe(1)
          expect(new Set(s.cards.map((c) => c.shape)).size, at).toBeLessThanOrEqual(3)
          const sets = setsOn(s.cards).length
          expect(s.noneOffered, at).toBe(plan.none > 0)
          if (sets === 0) expect(s.noneOffered, `${at}: no set and no «없음»`).toBe(true)
          // The board the band asks for, where the screen holds it.
          else if (s.cards.length === plan.cards) expect(sets, at).toBe(plan.sets)
          // solution() is a real set (or «없음» on an empty board), and playing it wins.
          const taps = setMatch.solution(s)!
          if (sets === 0) expect(taps, at).toEqual([s.cards.length])
          else expect(isSet(s.cards[taps[0]], s.cards[taps[1]], s.cards[taps[2]]), at).toBe(true)
          let played = s
          for (const t of taps) played = setMatch.tap(played, t)
          expect(setMatch.outcome(played), at).toEqual({ correct: true, accuracy: 1 })
        }
      }
    }
  })

  it('«없음» boards: about the band’s share from L16, none before; the clock is the same with or without a set', () => {
    for (const b of BANDS) {
      const boards = range(240).map((seed) => make(b, seed))
      const empty = boards.filter((s) => s.set === null).length / boards.length
      expect(Math.abs(empty - SET_MATCH_LADDER[b - 1].none), `L${b}: ${empty}`).toBeLessThanOrEqual(0.07)
      // The time bar must not tell an empty board.
      expect(new Set(boards.map((s) => s.limitMs)).size, `L${b}`).toBe(1)
    }
  })

  it('decoys: teaching boards have fewer near sets than chance, the top more; the hidden set has more attributes all different up the ladder', () => {
    const mean = (b: number, f: (s: SetMatchState) => number, n = 80) => range(n).reduce((sum, seed) => sum + f(make(b, seed)), 0) / n
    const nonEmpty = (b: number, f: (s: SetMatchState) => number) => {
      const boards = range(120).map((seed) => make(b, seed)).filter((s) => s.set !== null)
      return boards.reduce((sum, s) => sum + f(s), 0) / boards.length
    }
    // The top's one-set boards against L13's (the same twelve cards and one set, decoys left to chance).
    const chance12 = mean(13, (s) => nearMisses(s.cards))
    expect(mean(14, (s) => nearMisses(s.cards))).toBeGreaterThan(chance12 * 1.05)
    expect(mean(15, (s) => nearMisses(s.cards))).toBeGreaterThan(chance12 * 1.05)
    // Teaching boards (four cards, one set): fewer near sets than four random cards around a set.
    for (const b of [1, 4, 8]) {
      const row = SET_MATCH_LADDER[b - 1]
      const rng = createRng(b)
      let chance = 0
      for (let i = 0; i < 200; i++) chance += nearMisses(randomOneSetBoard(rng, row.vary, 4))
      expect(mean(b, (s) => nearMisses(s.cards), 120), `L${b}`).toBeLessThan((chance / 200) * 0.9)
    }
    // The hidden set: any kind at the bottom, two attributes all different from L13, three from L14.
    expect(nonEmpty(13, spreadOf)).toBeGreaterThanOrEqual(2)
    for (const b of [14, 15, 16, 18, 24]) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = make(b, seed)
        if (s.set) expect(spreadOf(s), `L${b} seed ${seed}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('variety: twenty seeds of a band are twenty boards, and a trial never repeats the last one’s kind of set', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (const b of BANDS) {
        const sigs = new Set(range(20).map((seed) => setMatch.signature(make(b, seed, ctx))))
        expect(sigs.size, `L${b} ${ctx.maxCols} cols`).toBe(20)
      }
    }
    for (const b of [1, 4, 8, 9, 13, 14]) {
      const chain: SetMatchState[] = []
      const rng = createRng(b * 31)
      for (let i = 0; i < 40; i++) chain.push(setMatch.create(b, rng, { ...PHONE, recent: after(chain, b) }))
      const kinds = chain.map((s) => setMatch.trialInfo!(s).carry!.split('|')[1])
      for (let i = 1; i < kinds.length; i++) if (chain[i].set && chain[i - 1].set) expect(kinds[i], `L${b} trial ${i}`).not.toBe(kinds[i - 1])
      // Teaching boards show every kind of set over a round, not one easy kind.
      if (b === 1) expect(new Set(kinds)).toEqual(new Set(['s', 'c', 'sc']))
    }
  })

  it('mechanics: each tag first appears at its stated band, and the board says what it holds', () => {
    const first = new Map<string, number>()
    for (const b of BANDS) for (let seed = 1; seed <= 30; seed++) for (const tag of setMatch.mechanics(make(b, seed))) if (!first.has(tag)) first.set(tag, b)
    for (const m of MECHANICS.filter((x) => x.game === 'setMatch')) expect(first.get(m.tag), m.tag).toBe(m.from)
    const s = make(20, 3)
    expect(setMatch.mechanics(s)).toEqual(expect.arrayContaining(['setMatch.board15', 'setMatch.color', 'setMatch.fill', 'setMatch.none']))
  })
})

describe('Set Match: blocked rules and rules arriving', () => {
  it('placement (every rule blocked): shape and count on the six-card board, then the clock alone — placement still separates a quick player from a slow one', () => {
    const blocked = ['setMatch.color', 'setMatch.fill', 'setMatch.none']
    const at = (level: number) => setMatchPlan(level, { blockRules: blocked, trialKind: 'placement', recent: [] })
    expect([1, 2, 3].map((l) => at(l).band)).toEqual([1, 2, 3])
    for (const level of [4, 8, 12, 16, 24]) {
      const p = at(level)
      expect([p.vary, p.cards, p.sets, p.none], `L${level}`).toEqual([['shape', 'count'], 6, 2, 0])
    }
    const clocks = [4, 6, 8, 10, 12, 14, 16].map((l) => at(l).limitMs)
    for (let i = 1; i < clocks.length; i++) expect(clocks[i]).toBeLessThan(clocks[i - 1])
    expect(at(4).limitMs).toBe(Math.round(SET_MATCH_LADDER[2].parMs * 0.8))
    // L12: six cards in about 4 s — a quick adult's pace, far past a slow one's; the floor 2 s from L15.
    expect(at(12).limitMs).toBeGreaterThan(3_000)
    expect(at(12).limitMs).toBeLessThan(5_000)
    expect(at(24).limitMs).toBe(2_000)
    // The boards themselves, and nothing blocked is reported.
    for (let seed = 1; seed <= 20; seed++) {
      const s = setMatch.create(14, createRng(seed), { ...PHONE, blockRules: blocked, trialKind: 'placement' })
      expect(s.cards.length).toBe(6)
      expect(setsOn(s.cards).length).toBe(2)
      expect(setMatch.mechanics(s).filter((t) => blocked.includes(t))).toEqual([])
    }
  })

  it('fill not yet met: three attributes on the twelve-card board with four sets, the clock running on from L7; «없음» not yet met: the band without the button', () => {
    const p = setMatchPlan(12, { blockRules: ['setMatch.fill', 'setMatch.none'], trialKind: 'counted', recent: [{ level: 12, kind: 'b4', carry: 'l|sl' }] })
    expect([p.vary.length, p.cards, p.sets, p.band]).toEqual([3, 12, 4, 7])
    expect(p.limitMs).toBeLessThan(setMatchLimitMs(7.99))
    const q = setMatchPlan(17, { blockRules: ['setMatch.none'], trialKind: 'counted', recent: [{ level: 17, kind: 'b17', carry: 'lf|scl' }] })
    expect([q.cards, q.sets, q.none, q.limitMs]).toEqual([12, 1, 0, setMatchLimitMs(17)])
    for (let seed = 1; seed <= 20; seed++) {
      const s = setMatch.create(17, createRng(seed), { ...PHONE, blockRules: ['setMatch.none'] })
      expect([s.noneOffered, setsOn(s.cards).length]).toEqual([false, 1])
    }
  })

  it('a rule met above its start opens on its first board — four cards for colour and fill, nine for «없음» — then the level’s board', () => {
    const fromPlacement: RecentTrial[] = [{ level: 9, kind: 'b3', carry: '|sc' }, { level: 12, kind: 'b3', carry: '|c' }]
    const colour = setMatchPlan(12, { blockRules: ['setMatch.fill', 'setMatch.none'], trialKind: 'counted', recent: fromPlacement })
    expect([colour.band, colour.cards, colour.vary.length, colour.limitMs]).toEqual([4, 4, 3, setMatchLimitMs(4)])
    const s = setMatch.create(12, createRng(5), { ...PHONE, blockRules: ['setMatch.fill', 'setMatch.none'], recent: fromPlacement })
    expect(s.cards.length).toBe(4)
    expect(setMatch.mechanics(s)).toContain('setMatch.color')
    // The next trial, colour met: the level's own content again (here fill is still blocked).
    const next = setMatchPlan(12, { blockRules: ['setMatch.fill', 'setMatch.none'], trialKind: 'counted', recent: [...fromPlacement.slice(1), { level: 12, ...setMatch.trialInfo!(s) }] })
    expect([next.band, next.cards]).toEqual([7, 12])
    // Fill at L14, «없음» at L20.
    const fill = setMatchPlan(14, { blockRules: ['setMatch.none'], trialKind: 'counted', recent: [{ level: 14, kind: 'b7', carry: 'l|sl' }] })
    expect([fill.band, fill.cards, fill.vary.length]).toEqual([8, 4, 4])
    const none = setMatchPlan(20, { blockRules: [], trialKind: 'counted', recent: [{ level: 20, kind: 'b18', carry: 'lf|sclf' }] })
    expect([none.band, none.cards, none.none]).toEqual([16, 9, 0.25])
    // The board that brings colour or fill shows it: its set has that attribute all different —
    // above the rule's start and at it alike (a player climbing from L3.9 into L4).
    const differ = (st: SetMatchState, attr: SetAttribute) => new Set(st.set!.map((i) => st.cards[i][attr])).size
    for (let seed = 1; seed <= 30; seed++) {
      const ctx = { ...PHONE, blockRules: ['setMatch.fill', 'setMatch.none'], recent: fromPlacement }
      expect(differ(setMatch.create(12, createRng(seed), ctx), 'color'), `L12 seed ${seed}`).toBe(3)
      expect(differ(setMatch.create(4.2, createRng(seed), ctx), 'color'), `L4.2 seed ${seed}`).toBe(3)
      const fillCtx = { ...PHONE, blockRules: ['setMatch.none'], recent: [{ level: 7.9, kind: 'b7', carry: 'l|cl' }] }
      expect(differ(setMatch.create(8.3, createRng(seed), fillCtx), 'fill'), `L8.3 seed ${seed}`).toBe(3)
    }
    // Once met, colour may be all the same again (a third of band-4 sets or so).
    const met = range(60).map((seed) => setMatch.create(4.2, createRng(seed), { ...PHONE, recent: [{ level: 4, kind: 'b4', carry: 'l|sl' }] }))
    expect(met.some((st) => differ(st, 'color') === 1)).toBe(true)
    // Not on placement or practice, not on a round's first trial, not where the rule starts anyway.
    expect(setMatchPlan(12, { blockRules: [], trialKind: 'placement', recent: fromPlacement }).band).toBe(12)
    expect(setMatchPlan(12, { blockRules: [], trialKind: 'counted', recent: [] }).band).toBe(12)
    expect(setMatchPlan(4.5, { blockRules: [], trialKind: 'counted', recent: fromPlacement }).band).toBe(4)
  })

  it('the how-to-play demo: four cards, three taps, a right answer', () => {
    const frames = buildDemo('setMatch')
    const first = frames[0].view as SetMatchView
    expect(first.cards).toHaveLength(4)
    expect(frames.filter((f) => f.tap !== undefined)).toHaveLength(3)
    const last = frames[frames.length - 1].view as SetMatchView
    expect(last.locked).toBe(true)
    expect(last.cards.filter((c) => c.tone === 'correct')).toHaveLength(3)
  })
})

/** Four random cards around a planted set — chance's near-miss count for a teaching board. */
function randomOneSetBoard(rng: Rng, vary: readonly SetAttribute[], n: number): SetCard[] {
  const vals = { shape: ['circle', 'triangle', 'square'], count: [1, 2, 3], color: ['black', 'blue', 'vermillion'], fill: ['solid', 'striped', 'outline'] } as const
  const card = (d: number[]): SetCard => ({ shape: vals.shape[d[0]], count: vals.count[d[1]], color: vals.color[d[2]], fill: vals.fill[d[3]] }) as SetCard
  const open = ATTRS.map((a) => vary.includes(a))
  for (;;) {
    const digits = Array.from({ length: n }, () => open.map((o) => (o ? rng.int(0, 2) : 0)))
    digits[2] = digits[0].map((x, i) => (6 - x - digits[1][i]) % 3)
    const cards = digits.map(card)
    if (new Set(cards.map((c) => JSON.stringify(c))).size === n && setsOn(cards).length === 1) return cards
  }
}

// ── the persona model ───────────────────────────────────────────────────────────────────────────

/**
 * A player looks at pairs in random order; each pair costs `k · PAIR_S[attributes] · √(cards/12)`
 * seconds (work out the third card, look for it) times a spread of the trial (lognormal, σ 0.25).
 * A pair whose third is on the board is the set — overlooked with chance `miss` (the search goes
 * on), or a finger slip `lapse`. A pair whose third is missing but a card one attribute off it is
 * there is a near miss, taken for a set with chance `slip`. Out of time on a board with «없음», the
 * player presses it with chance `guess`; every pair checked and nothing found, they press it.
 * The sharp adult takes 4 s a pair on twelve cards with four attributes: a capable newcomer to the
 * game. A practised SET player is about four times faster and is who the top bands are for. The
 * average 70-year-old is twice as slow as the sharp adult, the slow 75-year-old three times.
 */
const PAIR_S: Record<number, number> = { 2: 1.7, 3: 2.7, 4: 4.0 }
interface Persona {
  k: number
  slip: number
  miss: number
  guess: number
  lapse: number
}
const PERSONAS = {
  sharp: { k: 1, slip: 0.01, miss: 0.05, guess: 0.6, lapse: 0.01 },
  average70: { k: 2, slip: 0.015, miss: 0.08, guess: 0.5, lapse: 0.03 },
  slow75: { k: 3, slip: 0.02, miss: 0.1, guess: 0.5, lapse: 0.04 },
} satisfies Record<string, Persona>
type PersonaId = keyof typeof PERSONAS

type PairKind = 0 | 1 | 2 // set · near miss · nothing
interface Board {
  kinds: PairKind[]
  attrs: number
  cards: number
  empty: boolean
  none: boolean
}

function boardOf(cards: readonly SetCard[], vary: readonly SetAttribute[], none: boolean): Board {
  const kinds: PairKind[] = []
  const fits = (a: SetCard, b: SetCard, c: SetCard, attr: SetAttribute) => (a[attr] === b[attr] ? c[attr] === a[attr] : c[attr] !== a[attr] && c[attr] !== b[attr])
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      let best = 9
      for (let k = 0; k < cards.length && best > 0; k++) {
        if (k === i || k === j) continue
        best = Math.min(best, ATTRS.filter((attr) => !fits(cards[i], cards[j], cards[k], attr)).length)
      }
      kinds.push(best === 0 ? 0 : best === 1 ? 1 : 2)
    }
  }
  return { kinds, attrs: vary.length, cards: cards.length, empty: !kinds.includes(0), none }
}

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng.next())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next())
}

type Answer = { kind: 'set' | 'wrong' | 'none' | 'timeout'; ms: number }

/** One attempt at a board. */
function attempt(board: Board, limitMs: number, p: Persona, rng: Rng): Answer {
  const pair = p.k * PAIR_S[board.attrs] * Math.sqrt(board.cards / 12) * 1000 * Math.exp(0.25 * gauss(rng))
  let t = 0
  for (const kind of rng.shuffle(board.kinds)) {
    t += pair
    if (t > limitMs) return board.none && rng.chance(p.guess) ? { kind: 'none', ms: limitMs * 0.97 } : { kind: 'timeout', ms: limitMs }
    if (kind === 0 && !rng.chance(p.miss)) return { kind: rng.chance(p.lapse) ? 'wrong' : 'set', ms: t }
    if (kind === 1 && rng.chance(p.slip)) return { kind: 'wrong', ms: t }
  }
  return board.none ? { kind: 'none', ms: t } : { kind: 'timeout', ms: limitMs }
}

const right = (board: Board, a: Answer) => (a.kind === 'set' && !board.empty) || (a.kind === 'none' && board.empty)

function pRight(board: Board, limitMs: number, p: Persona, rng: Rng, n = 80): number {
  let ok = 0
  for (let i = 0; i < n; i++) if (right(board, attempt(board, limitMs, p, rng))) ok++
  return ok / n
}

/** A band's modelled accuracy at its first level (a trial at L b.0): boards with a set, and the band's empty share at the empty boards' rate. */
const bandBoards = new Map<number, { full: Board[]; empty: Board[]; limitMs: number }>()
function boardsAt(b: number) {
  let got = bandBoards.get(b)
  if (!got) {
    const full: Board[] = []
    const empty: Board[] = []
    for (let seed = 1; full.length < 30 || (SET_MATCH_LADDER[b - 1].none > 0 && empty.length < 12 && seed < 400); seed++) {
      const s = make(b, seed)
      const board = boardOf(s.cards, s.vary, s.noneOffered)
      if (board.empty) empty.push(board)
      else if (full.length < 30) full.push(board)
    }
    got = { full, empty, limitMs: setMatchLimitMs(b) }
    bandBoards.set(b, got)
  }
  return got
}
const accCache = new Map<string, { full: number; mixed: number }>()
function modelled(id: PersonaId, b: number) {
  const key = `${id}:${b}`
  let got = accCache.get(key)
  if (!got) {
    const { full, empty, limitMs } = boardsAt(b)
    const rng = createRng(b * 977 + id.length)
    const meanP = (bs: Board[]) => bs.reduce((sum, x) => sum + pRight(x, limitMs, PERSONAS[id], rng), 0) / bs.length
    const share = SET_MATCH_LADDER[b - 1].none
    const f = meanP(full)
    got = { full: f, mixed: (1 - share) * f + (share > 0 ? share * meanP(empty) : 0) }
    accCache.set(key, got)
  }
  return got
}

describe('Set Match: modelled people (model values, not measurements)', () => {
  it('level 1 is easy for everyone; each band harder than the last for all three — except where a rule starts small again', () => {
    for (const id of Object.keys(PERSONAS) as PersonaId[]) {
      expect(modelled(id, 1).mixed, `${id} L1`).toBeGreaterThanOrEqual(0.9)
      for (let b = 2; b <= SET_MATCH_MAX_LEVEL; b++) {
        const [was, now] = [modelled(id, b - 1), modelled(id, b)]
        if (RULE_BANDS.includes(b)) expect(now.full, `${id}: the ${b} rule opens on an easier board`).toBeGreaterThanOrEqual(was.full - 0.02)
        else expect(now.full, `${id} band ${b - 1} → ${b}`).toBeLessThanOrEqual(was.full + 0.02)
      }
    }
    // The slow 75-year-old is comfortable through the shape-and-count boards and the first colour boards.
    for (const b of [1, 2, 3, 4, 5]) expect(modelled('slow75', b).mixed, `slow75 L${b}`).toBeGreaterThanOrEqual(0.85)
  })

  it('the top is lost: the sharp adult under 85% from L12, under half from L18, near a quarter at L24 (empty boards guessed)', () => {
    const sharp = BANDS.map((b) => modelled('sharp', b).mixed)
    for (const b of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(sharp[b - 1], `sharp L${b}`).toBeGreaterThanOrEqual(0.9)
    // Where each settles (the first band under 85%): the sharp adult at L11-13, the slow 75-year-old at L5-7.
    const settle = (id: PersonaId) => BANDS.find((b) => !RULE_BANDS.includes(b) && modelled(id, b).mixed < 0.85)!
    expect(settle('sharp')).toBeGreaterThanOrEqual(11)
    expect(settle('sharp')).toBeLessThanOrEqual(13)
    expect(settle('slow75')).toBeGreaterThanOrEqual(5)
    expect(settle('slow75')).toBeLessThanOrEqual(7)
    expect(settle('average70')).toBeGreaterThanOrEqual(settle('slow75'))
    for (let b = 12; b <= 24; b++) if (!RULE_BANDS.includes(b)) expect(sharp[b - 1], `sharp L${b}`).toBeLessThan(0.85)
    for (let b = 18; b <= 24; b++) expect(sharp[b - 1], `sharp L${b}`).toBeLessThan(0.5)
    expect(sharp[23]).toBeLessThan(0.35)
    // On boards with a set (no guessing), the top is lost even more clearly.
    expect(modelled('sharp', 24).full).toBeLessThan(0.25)
  })
})

// ── the real round, played by the modelled people ──────────────────────────────────────────────────

const SIM_PLATFORM: PlatformContext = { maxCols: 5, maxRows: 7 }
const DAY0 = new Date('2026-11-12T10:00:00').getTime()

interface SimTrial {
  kind: string
  level: number
  /** The modelled chance of a right answer on this very board and clock. */
  p: number
  correct: boolean
}

/** A first round and the next days' rounds of Set Match, through useBrainRound, by a modelled person. */
function playDays(id: PersonaId, seed: number, rounds: number, stopAfter?: number): SimTrial[][] {
  const persona = PERSONAS[id]
  const rng = createRng(seed)
  const seeded = createRng(seed ^ 0x5bd1e995)
  const random = vi.spyOn(Math, 'random').mockImplementation(() => seeded.next())
  useBrainStore.setState({ progress: emptyProgress(), meta: emptyMeta(), history: emptyHistory(), storageKey: `sim-${id}-${seed}` })
  const out: SimTrial[][] = []
  try {
    for (let r = 0; r < rounds; r++) {
      vi.setSystemTime(DAY0 + r * 86_400_000)
      const { result, unmount } = renderHook(() => useBrainRound('setMatch', SIM_PLATFORM))
      const log: SimTrial[] = []
      for (let guard = 0; guard < 4000 && !result.current.done; guard++) {
        const cur = result.current
        if (cur.intro) {
          act(() => cur.ackIntro())
          continue
        }
        if (cur.result) {
          act(() => vi.advanceTimersByTime(520))
          act(() => result.current.skipReveal())
          act(() => vi.advanceTimersByTime(20))
          continue
        }
        const v = cur.view
        if (v.kind === 'setMatch' && v.difficulty === 'foundation' && !v.locked) {
          // The three-card starter has one valid set and no clock; the old timed-search model
          // would otherwise wait forever for a timer that deliberately does not exist.
          act(() => vi.advanceTimersByTime(800))
          for (const tap of result.current.solution ?? []) act(() => result.current.tap(tap))
          log.push({ kind: cur.trialKind, level: cur.level, p: 1, correct: result.current.result?.correct ?? false })
          continue
        }
        if (v.kind !== 'setMatch' || v.locked || !cur.timer) {
          act(() => vi.advanceTimersByTime(50))
          continue
        }
        if (stopAfter !== undefined && log.filter((t) => t.kind !== 'practice').length >= stopAfter) {
          act(() => cur.stop())
          continue
        }
        const cards = v.cards.map((c) => c.card)
        const board = boardOf(cards, v.vary, v.extra !== undefined)
        // The time the clock still has (it started when the board took input).
        const limit = cur.timer.limitMs - (Date.now() - cur.timer.startedAt)
        const trial: SimTrial = { kind: cur.trialKind, level: cur.level, p: pRight(board, cur.timer.limitMs, persona, rng, 60), correct: false }
        const answer = attempt(board, limit, persona, rng)
        if (answer.kind === 'timeout') act(() => vi.advanceTimersByTime(limit + 100))
        else {
          act(() => vi.advanceTimersByTime(Math.max(1, Math.round(answer.ms) - 10)))
          let taps: number[]
          if (answer.kind === 'none') taps = [v.extra!.index]
          else if (answer.kind === 'set' && !board.empty) taps = result.current.solution ?? []
          else taps = wrongTriple(cards)
          for (const t of taps) if (!result.current.result) act(() => result.current.tap(t))
        }
        trial.correct = result.current.result?.correct ?? false
        log.push(trial)
      }
      unmount()
      out.push(log)
    }
  } finally {
    random.mockRestore()
  }
  return out
}

/** A wrong pick: a near miss if there is one (the trap the model fell for), else any triple that is no set. */
function wrongTriple(cards: readonly SetCard[]): number[] {
  let any: number[] | null = null
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        const broken = brokenAttributes(cards[i], cards[j], cards[k]).length
        if (broken === 1) return [i, j, k]
        if (broken > 0 && !any) any = [i, j, k]
      }
    }
  }
  return any!
}

describe('Set Match: the real round, played by modelled people', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a sharp adult meets real challenge (a board they miss one time in ten or more) within four trials after practice, and plays no long run of easy boards', () => {
    vi.useFakeTimers()
    const runs = range(30).map((seed) => playDays('sharp', seed * 131, 1, 8)[0])
    let early = 0
    for (const log of runs) {
      const played = log.filter((t) => t.kind !== 'practice')
      const practice = log.length - played.length
      expect(practice, 'practice is two to four boards').toBeGreaterThanOrEqual(2)
      expect(practice).toBeLessThanOrEqual(4)
      const first = played.findIndex((t) => t.p <= 0.9)
      if (first >= 0 && first < 4) early++
      // Never more than five boards in a row they get right 97% of the time.
      let run = 0
      for (const t of played) {
        run = t.p >= 0.97 ? run + 1 : 0
        expect(run).toBeLessThanOrEqual(5)
      }
    }
    expect(early, `${early} of 30`).toBeGreaterThanOrEqual(24)
  }, 60_000)

  it('a slow 75-year-old starts on easy boards and settles near 80% right on the next days, never parked on boards they mostly miss', () => {
    vi.useFakeTimers()
    const runs = range(12).map((seed) => playDays('slow75', seed * 97, 3))
    let counted = 0
    let right = 0
    let hopeless = 0
    for (const days of runs) {
      const firstPlaced = days[0].find((t) => t.kind === 'placement')
      expect(firstPlaced).toBeDefined()
      expect(firstPlaced!.level).toBeLessThanOrEqual(3)
      for (const log of days.slice(1)) {
        for (const t of log.filter((x) => x.kind === 'counted')) {
          counted++
          if (t.correct) right++
          if (t.p < 0.5) hopeless++
        }
      }
    }
    const accuracy = right / counted
    expect(accuracy, `${right}/${counted}`).toBeGreaterThanOrEqual(0.72)
    expect(accuracy).toBeLessThanOrEqual(0.92)
    expect(hopeless / counted, `${hopeless}/${counted} boards under 50%`).toBeLessThanOrEqual(0.15)
  }, 120_000)
})
