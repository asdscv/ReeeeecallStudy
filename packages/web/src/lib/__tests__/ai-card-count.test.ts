/**
 * The AI wizard's default card count must follow the SERVER's free quota.
 *
 * Both clients used to open the wizard with `Math.min(10, affordable.free)`. The
 * 10 was a hand-copied mirror of the server's free daily quota, which mig 154
 * turned into a config value (`admin_set_ai_free_quota`). The mirror is therefore
 * a silent cap: raise the quota and the wizard keeps defaulting to 10.
 *
 * The mirror was never load-bearing either — `get_ai_generation_quota` returns
 * `remaining = GREATEST(0, free_limit - used)`, so `Affordable.free` is already
 * bounded by the configured quota.
 *
 * These assertions pin both halves: the cap is gone, and the ONE bound the client
 * legitimately owns (its own input range) is still enforced.
 */
import { describe, it, expect } from 'vitest'
import { defaultCardCount, MAX_CARD_COUNT } from '@reeeeecall/shared/lib/ai/card-count'

describe('defaultCardCount', () => {
  it('THE REGRESSION: a quota raised above 10 is not capped at 10', () => {
    // What the old `Math.min(10, free)` produced vs what the server allows.
    expect(defaultCardCount(50)).toBe(50)
    expect(defaultCardCount(11)).toBe(11)
    // Sanity: the historical quota still behaves as before, so the change is not
    // observable until an admin actually moves the number.
    expect(defaultCardCount(10)).toBe(10)
    expect(defaultCardCount(3)).toBe(3)
  })

  it('never opens below 1, so an exhausted free tier is still usable', () => {
    expect(defaultCardCount(0)).toBe(1)
    // Defensive: a negative can only come from a corrupted payload, but it must
    // not produce 0 or a negative default.
    expect(defaultCardCount(-5)).toBe(1)
  })

  it('never exceeds what the count input accepts', () => {
    // An owner may set the free quota above the input's own range; the default
    // must stay a value the user can type back.
    expect(defaultCardCount(500)).toBe(MAX_CARD_COUNT)
    expect(defaultCardCount(MAX_CARD_COUNT + 1)).toBe(MAX_CARD_COUNT)
    expect(defaultCardCount(MAX_CARD_COUNT)).toBe(MAX_CARD_COUNT)
  })

  it('yields an integer for a fractional remaining', () => {
    // The RPC returns an integer today; this keeps a future numeric/JSON shape
    // from putting 7.5 into a number input.
    expect(defaultCardCount(7.9)).toBe(7)
    expect(Number.isInteger(defaultCardCount(7.9))).toBe(true)
  })

  it('falls back to 1 rather than NaN when the quota read is unusable', () => {
    // getAiGenerationQuota fails open, so `free` should always be a number — but
    // NaN reaching a controlled number input wedges the field, so it is pinned.
    expect(defaultCardCount(NaN)).toBe(1)
    expect(defaultCardCount(Infinity)).toBe(1)
  })
})
