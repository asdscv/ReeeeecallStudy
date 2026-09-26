import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketplaceListing } from '../types/database'

/**
 * Starter decks for a brand-new account.
 *
 * A new account owns nothing, so onboarding used to make it build a deck, pick a
 * template and type cards before it could study anything — three chores before the
 * first card. These are the decks we hand someone instead: free, official, and
 * written for their own language.
 *
 * Takes the client rather than importing one: web runs two Supabase clients (its
 * own plus the shared singleton) and the caller knows which one holds its session.
 */

// Every official deck teaches English, so `learning_language` never discriminates —
// `native_language` is the axis that matters. A Korean speaker must not be handed
// the Spanish→English deck.
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

function baseQuery(client: SupabaseClient) {
  return client
    .from('marketplace_listings')
    .select('*')
    .eq('is_active', true)
    .eq('owner_is_official', true)
    .eq('is_paid', false)
}

/**
 * Free official decks in the viewer's own language, easiest first.
 *
 * Falls back to the most-acquired official decks when the catalog has nothing in
 * that language — true today for `en`, which has zero decks because every deck
 * teaches English *to* someone else. An empty first screen is worse than a deck
 * pointing the wrong way.
 */
export async function fetchStarterDecks(
  client: SupabaseClient,
  locale: string,
  limit = 3,
): Promise<MarketplaceListing[]> {
  const lang = normalizeLang(locale)

  const { data, error } = await baseQuery(client)
    .eq('native_language', lang)
    .limit(60)

  if (!error && data && data.length > 0) {
    return preferRecognitionDirection(data as MarketplaceListing[], lang)
      .sort(easiestFirst)
      .slice(0, limit)
  }

  const { data: fallback, error: fallbackError } = await baseQuery(client)
    .order('acquire_count', { ascending: false })
    .order('id', { ascending: true })  // 640 of 649 listings sit at acquire_count 0 — without a tiebreak the page is arbitrary
    .limit(limit)

  if (fallbackError || !fallback) return []
  return fallback as MarketplaceListing[]
}
