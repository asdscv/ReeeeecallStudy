import type { MarketplaceListing } from '../types/database'

/**
 * Which decks a brand-new account should be handed — the ranking half, with no I/O.
 *
 * A new account owns nothing, so onboarding used to make it build a deck, pick a
 * template and type cards before it could study anything. These functions decide
 * what to offer instead. Fetching lives in `stores/starter-decks` — this layer is
 * the pure domain and may not reach for the data adapter (tools/check-arch.ts).
 */

// Every official deck teaches English, so `learning_language` is the same value on
// all 649 rows and discriminates nothing. `native_language` is the axis that
// matters: a Korean speaker must not be handed the Spanish→English deck.
const LEVEL_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 }

// Beginner decks are the BIG ones here (~300 cards vs ~100 for advanced), so
// ordering by card_count alone would surface advanced decks first. Level leads;
// size only breaks ties inside a level.
export function easiestFirst(a: MarketplaceListing, b: MarketplaceListing): number {
  const ra = LEVEL_RANK[a.study_level ?? ''] ?? 99
  const rb = LEVEL_RANK[b.study_level ?? ''] ?? 99
  if (ra !== rb) return ra - rb
  if (a.card_count !== b.card_count) return a.card_count - b.card_count
  return a.title.localeCompare(b.title)
}

export function normalizeLang(locale: string): string {
  return (locale || 'en').split('-')[0].toLowerCase()
}

/**
 * Official decks ship as bidirectional pairs — the same 301 cards as en→ko and again
 * as ko→en — and both rows carry the same category, level and card_count. Left alone,
 * two of the three starter slots go to one deck shown twice.
 *
 * Keeping only the rows whose `target:` tag is the viewer's own language drops exactly
 * one side of every pair, and never merges two genuinely different decks the way a
 * grouping key would (TOEIC 900 and TOEIC 990 share category, level and card_count,
 * and 229 of the 649 listings carry no batch tag to separate them).
 *
 * It also picks the direction a beginner should start on: prompt in English, answer in
 * the language they already have.
 */
export function preferRecognitionDirection(
  listings: MarketplaceListing[],
  lang: string,
): MarketplaceListing[] {
  const recognition = listings.filter((l) => l.tags?.includes(`target:${lang}`))
  // Some decks exist in one direction only — never trade a populated list for an empty one.
  return recognition.length > 0 ? recognition : listings
}

/** One side of each pair, easiest first, capped. */
export function pickStarters(
  listings: MarketplaceListing[],
  lang: string,
  limit: number,
): MarketplaceListing[] {
  return preferRecognitionDirection(listings, lang).sort(easiestFirst).slice(0, limit)
}
