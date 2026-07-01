import { useEffect } from 'react'
import { useDeckStore } from '../stores/deck-store'

/**
 * Client PRE-FLIGHT for the owned-card limit (mig 116). The SERVER is always the
 * authority (reserve_card_positions/copy_deck_for_user raise PT402); this hook only
 * gives instant UX so the user isn't sent to generate/import cards they can't save.
 *
 * FAIL-OPEN by design: if usage is unknown (not fetched yet, or the RPC errored),
 * `available` is +Infinity and nothing is blocked — a stale/missing read must never
 * wrongly block a legitimate create (the server still enforces).
 */
export function useCardLimit() {
  const cardUsage = useDeckStore((s) => s.cardUsage)
  const fetchCardUsage = useDeckStore((s) => s.fetchCardUsage)
  useEffect(() => { void fetchCardUsage() }, [fetchCardUsage])

  const known = cardUsage != null
  const available = known ? cardUsage!.available : Number.POSITIVE_INFINITY
  return {
    cardUsage,
    available,
    /** true only when usage is KNOWN and adding n cards would exceed the cap. */
    exceeds: (n: number) => known && available < n,
    /** true only when usage is KNOWN and the cap is already reached. */
    reached: known && available <= 0,
    /** re-fetch (e.g. after a save) */
    refresh: fetchCardUsage,
  }
}
