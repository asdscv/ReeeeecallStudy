import type { MarketplaceListing } from '../types/database'
import { readDeckFacts, taughtLanguage } from './deck-audience'

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

/**
 * Which languages these decks would teach this viewer.
 *
 * One, for everyone the catalog was built for: a Korean speaker's decks all teach
 * English. Seven, for an English speaker, because every deck is an en<->X pair and X
 * varies. That difference decides whether a first screen can choose for them.
 */
export function taughtLanguages(listings: MarketplaceListing[], lang: string): string[] {
  const seen = new Set<string>()
  for (const l of listings) {
    const taught = taughtLanguage(readDeckFacts(l.tags), lang)
    if (taught) seen.add(taught)
  }
  return [...seen].sort()
}

/**
 * One side of each pair, easiest first, capped.
 *
 * When the candidates span several taught languages — only English speakers today —
 * the list leads with one deck per language instead of five batches of whichever
 * language sorted first. Three rows reading Korean / Japanese / Spanish are a language
 * choice; three batches of Vietnamese are a decision already made for them.
 */
export function pickStarters(
  listings: MarketplaceListing[],
  lang: string,
  limit: number,
): MarketplaceListing[] {
  const pool = preferRecognitionDirection(listings, lang).sort(easiestFirst)
  if (taughtLanguages(pool, lang).length <= 1) return pool.slice(0, limit)

  const firstOfEach: MarketplaceListing[] = []
  const taken = new Set<string>()
  for (const l of pool) {
    const taught = taughtLanguage(readDeckFacts(l.tags), lang)
    if (!taught || taken.has(taught)) continue
    taken.add(taught)
    firstOfEach.push(l)
    if (firstOfEach.length === limit) break
  }
  // Short of `limit` languages: top up from the ranked pool rather than under-fill.
  for (const l of pool) {
    if (firstOfEach.length === limit) break
    if (!firstOfEach.includes(l)) firstOfEach.push(l)
  }
  return firstOfEach
}
