import { supabase } from '../lib/supabase'
import { normalizeLang, pickStarters, taughtLanguages } from '../lib/starter-decks'
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
 * Matches on `native_languages` rather than the singular `native_language`: every
 * official deck is an en<->X pair and serves both sides, but only the non-English side
 * was ever recorded (migration 281 writes the pair). Filtering on the singular column
 * returned nothing at all for an English speaker.
 *
 * The fallback survives for a locale the catalog genuinely does not cover — an empty
 * first screen is worse than a deck in a language they did not ask for.
 */
export async function fetchStarterDecks(locale: string, limit = 3): Promise<MarketplaceListing[]> {
  const lang = normalizeLang(locale)

  // `en` matches all 649 rows, so an unordered page would rank an arbitrary slice.
  // Order in the query and take enough to cover every language pair.
  const { data, error } = await freeOfficial()
    .contains('native_languages', [lang])
    .order('card_count', { ascending: true })
    .order('id', { ascending: true })
    .limit(1000)

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

/** How many decks a brand-new account is given so its dashboard is not empty. */
export const STARTER_SUBSCRIPTION_COUNT = 5

/**
 * Give a brand-new account a small shelf of decks in its own language.
 *
 * Without this the first screen after signup is "아직 덱이 없습니다" and the only thing
 * to do is author cards — which is where 13 of 16 accounts stopped. Subscribing is
 * cheap: these are `share_mode = 'subscribe'` official decks, so no cards are copied,
 * `count_official_cards` is false so nothing touches the ownership cap, and unstudied
 * cards land in `new` rather than `due`, so the dashboard reads as a shelf and not as
 * a backlog.
 *
 * Deliberately not random. The catalog's beginner decks are the big ones (~300 cards)
 * and the advanced ones are small (~100), and every deck ships in both directions, so
 * an unranked pick hands a first-timer an advanced deck and both halves of one pair.
 * `pickStarters` is the same ranking the onboarding picker uses.
 *
 * Tops up to `count` rather than asking "did we already do anything". Production
 * showed why: the first launch subscribed one deck and the tab closed before the rest
 * of the sequential calls landed, and a has-anything guard would have frozen that
 * account at one deck forever. Acquiring is idempotent and the calls now go out
 * together, so a cut-off run repairs itself on the next launch.
 *
 * Three things stop it: an account that authored or copied a deck of its own, a shelf
 * that is already full, and an account that has begun studying. The last two together
 * mean someone who unsubscribes a deck they were given gets it back only if they never
 * studied anything — a narrow window, and the alternative is never repairing a
 * half-finished shelf.
 */
export async function ensureStarterSubscriptions(
  locale: string,
  count = STARTER_SUBSCRIPTION_COUNT,
): Promise<number> {
  const lang = normalizeLang(locale)
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) return 0

  const [owned, shares, progress] = await Promise.all([
    supabase.from('decks').select('id').eq('user_id', userId).limit(1),
    supabase.from('deck_shares').select('id').eq('recipient_id', userId).limit(count),
    supabase.from('user_card_progress').select('card_id').eq('user_id', userId).limit(1),
  ])
  if (owned.error || shares.error || progress.error) return 0

  // Authored or copied a deck of their own — they are past needing a shelf.
  if ((owned.data?.length ?? 0) > 0) return 0
  // Already studying: whatever they have is what they chose.
  if ((progress.data?.length ?? 0) > 0) return 0
  // Shelf is full.
  if ((shares.data?.length ?? 0) >= count) return 0

  const starters = await fetchStarterDecks(locale, count)
  if (starters.length === 0) return 0

  // Every audience the catalog was built for has exactly one counterpart language, so
  // the shelf is unambiguous. An English speaker has seven, and nothing here says which
  // one they came for — filling their account with five languages is worse than an empty
  // one. Let the picker ask instead.
  if (taughtLanguages(starters, lang).length > 1) return 0

  // Together, not one after another: a first launch must not depend on five sequential
  // round trips surviving however long the visitor stays on the page.
  const results = await Promise.all(
    starters.map((listing) => supabase.rpc('acquire_listing', { p_listing_id: listing.id })),
  )
  // One refusal (card limit, a deck pulled from the catalog) must not cost the rest.
  return results.filter((r) => !r.error).length
}
