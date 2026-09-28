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

// The stored `learning_language` is the same value on all 649 official rows and
// discriminates nothing — it answers for one audience only. The deck's language pair
// is what matters: a Korean speaker must not be handed the Spanish→English deck, and
// an English speaker must not be told these decks teach English to them.
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

/** Nobody should be scrolling a first screen; the catalog covers seven languages. */
const MAX_LANGUAGE_CHOICES = 8

/**
 * One side of each pair, easiest first.
 *
 * With one taught language — every audience the catalog was built for — this is the
 * easiest `limit` decks, and `limit` means what it says.
 *
 * With several, the list becomes a language menu: one deck per language, and **every**
 * language, not the first `limit` of them. Capping at three showed an English speaker
 * Indonesian, Vietnamese and Spanish, and silently hid Korean and Japanese — the two
 * the catalog covers best — behind a sort order they cannot see or change. A menu that
 * omits most of the menu is worse than a long one.
 */
export function pickStarters(
  listings: MarketplaceListing[],
  lang: string,
  limit: number,
): MarketplaceListing[] {
  const pool = preferRecognitionDirection(listings, lang).sort(easiestFirst)
  if (taughtLanguages(pool, lang).length <= 1) return pool.slice(0, limit)

  const cap = Math.min(Math.max(limit, taughtLanguages(pool, lang).length), MAX_LANGUAGE_CHOICES)
  const firstOfEach: MarketplaceListing[] = []
  const taken = new Set<string>()
  for (const l of pool) {
    const taught = taughtLanguage(readDeckFacts(l.tags), lang)
    if (!taught || taken.has(taught)) continue
    taken.add(taught)
    firstOfEach.push(l)
    if (firstOfEach.length === cap) break
  }
  // Fewer languages than slots: top up from the ranked pool rather than under-fill.
  for (const l of pool) {
    if (firstOfEach.length === cap) break
    if (!firstOfEach.includes(l)) firstOfEach.push(l)
  }
  return firstOfEach
}
