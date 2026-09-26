import { supabase } from '../lib/supabase'
import { normalizeLang, pickStarters } from '../lib/starter-decks'
import type { MarketplaceListing } from '../types/database'

/**
 * Reads the free official catalog for a first-run account.
 *
 * Lives beside the stores rather than in `lib/` because it talks to the data
 * adapter; `lib/starter-decks` holds the part that decides which rows win.
 */

function freeOfficial() {
  return supabase
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
export async function fetchStarterDecks(locale: string, limit = 3): Promise<MarketplaceListing[]> {
  const lang = normalizeLang(locale)

  const { data, error } = await freeOfficial().eq('native_language', lang).limit(60)

  if (!error && data && data.length > 0) {
    return pickStarters(data as MarketplaceListing[], lang, limit)
  }

  const { data: fallback, error: fallbackError } = await freeOfficial()
    .order('acquire_count', { ascending: false })
    .order('id', { ascending: true })  // 640 of 649 sit at acquire_count 0 — without a tiebreak the page is arbitrary
    .limit(limit)

  if (fallbackError || !fallback) return []
  return fallback as MarketplaceListing[]
}
