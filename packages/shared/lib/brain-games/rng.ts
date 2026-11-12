/**
 * Seeded PRNG for brain-game rounds.
 *
 * Every round is generated, never picked from a list, so the games never run out and never
 * repeat a fixed set. A seed (not Math.random directly) keeps a round reproducible in tests.
 */
export interface Rng {
  /** [0, 1) */
  next(): number
  /** Inclusive on both ends. */
  int(min: number, max: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
  /** `count` distinct items, in random order. */
  sample<T>(items: readonly T[], count: number): T[]
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle,
    sample: (items, count) => shuffle(items).slice(0, Math.max(0, Math.min(count, items.length))),
  }
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
}

/** 0..n-1 */
export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
