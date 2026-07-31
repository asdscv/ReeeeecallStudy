// Card-count bounds for the AI generation wizard, shared so web and mobile cannot
// drift from each other.
//
// WHY THIS FILE EXISTS. Both clients used to open the wizard with
// `Math.min(10, affordable.free)`, where 10 was a hand-copied mirror of the
// server's free daily quota. mig 154 made that quota a config value
// (`ai_pricing_settings.free_cards_per_day`, set via `admin_set_ai_free_quota`),
// so the mirror became a bug waiting for the first quota change: raise the quota
// to 50 and the wizard would still have defaulted to 10.
//
// The mirror was never needed. `get_ai_generation_quota` returns
// `remaining = GREATEST(0, free_limit - used)`, so the value the clients already
// hold (`Affordable.free`) is ALREADY bounded by whatever quota is configured.
// The only bound the client legitimately owns is its own input range.

/**
 * Largest card count the wizard's number input accepts.
 *
 * This is a UI/product bound, NOT the server's. The edge function generates at
 * most `MAX_CARDS_PER_CALL = 25` per request and the generate store batches in
 * 25-card chunks, so any value here is deliverable — but the count input clamps
 * typed values to this number, and a default above it would be a value the user
 * cannot reproduce by typing.
 */
export const MAX_CARD_COUNT = 100

/**
 * The card count to open the wizard with.
 *
 * `freeRemaining` is the server-authoritative remaining free cards for today
 * (`Affordable.free`). Defaulting to it means a default generation never
 * overshoots the free allowance and silently spends the wallet.
 *
 * Clamped to `[1, MAX_CARD_COUNT]`:
 *   - at least 1, so an exhausted free tier still opens with a usable value
 *     (the first card is then a paid one, which the wallet copy states);
 *   - at most MAX_CARD_COUNT, because the count input itself clamps there — an
 *     owner raising the free quota above it must not produce a default the user
 *     cannot type back.
 *
 * Deliberately NOT clamped to any hardcoded free-tier number: that is the drift
 * this function exists to remove.
 */
export function defaultCardCount(freeRemaining: number): number {
  if (!Number.isFinite(freeRemaining)) return 1
  return Math.max(1, Math.min(MAX_CARD_COUNT, Math.floor(freeRemaining)))
}
