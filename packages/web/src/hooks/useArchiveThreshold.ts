import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Read-only "archived over the card limit" affordance for the deck detail view
 * (mig 123). Two server RPCs, both auth.uid()-scoped (no caller-supplied id):
 *
 *  - get_active_card_threshold() → the account-wide boundary: the created_at of
 *    the (limit)-th oldest OWNED, non-official card. A single per-user value, so
 *    it's fetched ONCE and shared across every DeckDetailPage mount via a
 *    module-level TTL cache rather than re-queried per deck. NULL = the user is
 *    NOT over the limit → nothing is archived (all cards active).
 *  - get_deck_archived_count(deckId) → how many of THIS deck's owned non-official
 *    cards fall after the boundary (0 when not the owner or threshold is null).
 *
 * A card is ARCHIVED-from-study iff threshold != null && card.created_at > threshold
 * (STRICT >, matching the server's created_at <= threshold study filter — boundary
 * ties stay active). Archived cards remain fully viewable/editable/deletable; this
 * hook only powers a badge + a deck-level note. FAIL-OPEN: any RPC error leaves the
 * threshold null / count 0 so we never wrongly badge a card as locked.
 */

let cachedThreshold: string | null = null
let thresholdFetchedAt = 0
let inFlight: Promise<string | null> | null = null
const TTL_MS = 60_000

async function loadThreshold(force = false): Promise<string | null> {
  const now = Date.now()
  if (!force && thresholdFetchedAt > 0 && now - thresholdFetchedAt < TTL_MS) {
    return cachedThreshold
  }
  if (inFlight) return inFlight
  inFlight = (async () => {
    const { data, error } = await supabase.rpc('get_active_card_threshold')
    inFlight = null
    if (error) return cachedThreshold // keep last known (fail-open); don't wrongly badge
    cachedThreshold = (data as string | null) ?? null
    thresholdFetchedAt = Date.now()
    return cachedThreshold
  })()
  return inFlight
}

export interface ArchiveThreshold {
  /** created_at boundary; null = not over the limit → nothing archived. */
  threshold: string | null
  /** owned non-official cards of THIS deck past the boundary (server-exact). */
  archivedCount: number
  /** true iff this card is archived-from-study (strict created_at > threshold). */
  isArchived: (createdAt: string) => boolean
}

/**
 * @param deckId       the deck being viewed
 * @param opts.enabled skip both RPCs when false (e.g. a subscribed/read-only deck
 *                     whose cards the user does not own — never archived here)
 * @param opts.refreshKey bump (e.g. cards.length) to force a re-check after a
 *                     create/delete frees or fills space
 */
export function useArchiveThreshold(
  deckId: string | undefined,
  opts?: { enabled?: boolean; refreshKey?: number },
): ArchiveThreshold {
  const enabled = opts?.enabled ?? true
  const refreshKey = opts?.refreshKey ?? 0

  const [threshold, setThreshold] = useState<string | null>(cachedThreshold)
  const [archivedCount, setArchivedCount] = useState(0)
  const lastKey = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    // Force past the TTL cache only when refreshKey actually changed (a write on
    // this deck); the first run per session reuses the shared cache across decks.
    const force = lastKey.current !== null && lastKey.current !== refreshKey
    lastKey.current = refreshKey
    let alive = true
    void loadThreshold(force).then((t) => {
      if (alive) setThreshold(t)
    })
    return () => {
      alive = false
    }
  }, [enabled, refreshKey])

  useEffect(() => {
    if (!enabled || !deckId) return
    let alive = true
    void supabase
      .rpc('get_deck_archived_count', { p_deck_id: deckId })
      .then(({ data, error }) => {
        if (!alive) return
        setArchivedCount(error ? 0 : Number(data ?? 0))
      })
    return () => {
      alive = false
    }
  }, [deckId, enabled, refreshKey])

  const thresholdMs = enabled && threshold ? new Date(threshold).getTime() : null
  const isArchived = (createdAt: string) =>
    thresholdMs != null && new Date(createdAt).getTime() > thresholdMs

  // Gate the count in the return (rather than resetting state synchronously in the
  // effect) so a disabled/read-only deck reports nothing archived without an extra
  // render or a lint-flagged setState-in-effect.
  return { threshold, archivedCount: enabled ? archivedCount : 0, isArchived }
}
