import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { deckListingFilter, parseDeckFamily } from '@reeeeecall/shared/lib/official-deck-family'

export interface OfficialDeckSummary {
  id: string
  title: string
  card_count: number
}

// Both drop-off CTAs on a page ask for the same deck; share one request.
const cache = new Map<string, Promise<OfficialDeckSummary | null>>()

function fetchDeck(category: string, tags: string[]): Promise<OfficialDeckSummary | null> {
  const cacheKey = `${category}|${tags.join(',')}`
  let pending = cache.get(cacheKey)
  if (!pending) {
    pending = Promise.resolve(
      supabase
        .from('marketplace_listings')
        .select('id, title, card_count')
        .eq('is_active', true)
        .eq('owner_is_official', true)
        .eq('category', category)
        .contains('tags', tags)
        .limit(1)
        .maybeSingle(),
    ).then(({ data }) => (data as OfficialDeckSummary | null) ?? null, () => null)
    cache.set(cacheKey, pending)
  }
  return pending
}

/** The official deck for this family in the reader's language, or null (none exists, or still loading). */
export function useOfficialDeck(deckFamily: string | undefined, readerLanguage: string): OfficialDeckSummary | null {
  const family = parseDeckFamily(deckFamily)
  const filter = family ? deckListingFilter(family, readerLanguage) : null
  const key = filter ? `${filter.category}|${filter.tags.join(',')}` : null
  const [result, setResult] = useState<{ key: string; deck: OfficialDeckSummary | null } | null>(null)

  useEffect(() => {
    if (!key) return
    const [category, tags] = key.split('|')
    let cancelled = false
    fetchDeck(category, tags.split(',')).then((deck) => { if (!cancelled) setResult({ key, deck }) })
    return () => { cancelled = true }
  }, [key])

  // A result for an earlier family or language is stale, not "no deck".
  return result && result.key === key ? result.deck : null
}
