/**
 * Pack B growth levers — the store's RPC contract (mig 154 setters, mig 177 getter).
 *
 * These are money/growth knobs, and the ways they break are silent:
 *
 *   * sending `p_usd_won_rate` at all. mig 149 pins it with CHECK (usd_won_rate = 1),
 *     so a non-null value makes the whole pricing write fail — including the
 *     margin change the admin actually asked for.
 *   * sending a number where the RPC expects "leave it alone". Both
 *     admin_set_card_limit args are COALESCEd, so passing 0/false instead of null
 *     would quietly reset the column the admin did not touch.
 *   * not re-reading after a write, which leaves the form showing the old value
 *     and invites a second, wrong edit on top of it.
 *
 * None of that shows up in a screenshot, so it is pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
// The web store re-exports the shared one, which imports the shared client —
// mocking only the web path leaves the real client in place and every assertion
// sees zero calls.
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabase: () => mockSupabase,
  initSupabase: vi.fn(),
}))

import { useAdminStore } from '../admin-store'

const LEVERS = {
  free_cards_per_day: 10,
  won_per_credit: 100,
  target_margin_bps: 8000,
  ai_settings_updated_at: '2026-07-31T00:00:00Z',
  max_owned_cards: 1000,
  count_official_cards: false,
  card_limit_updated_at: '2026-07-31T00:00:00Z',
}

/** Answer the getter with LEVERS and every setter with a bare success. */
function happyPath(levers = LEVERS) {
  mockSupabase.rpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'admin_get_growth_levers' ? { data: levers, error: null } : { data: null, error: null },
    ),
  )
}

const callsTo = (fn: string) => mockSupabase.rpc.mock.calls.filter((c) => c[0] === fn)

beforeEach(() => {
  vi.clearAllMocks()
  useAdminStore.setState({ growthLevers: null, growthLeversError: null })
})

describe('fetchGrowthLevers', () => {
  it('reads through the RPC, not a table select', async () => {
    happyPath()
    await useAdminStore.getState().fetchGrowthLevers()

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_get_growth_levers')
    // Both config tables are RLS-enabled with zero policies; a .from() here could
    // only ever return empty.
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(useAdminStore.getState().growthLevers).toEqual(LEVERS)
  })

  it('surfaces a read failure instead of showing misleading zeros', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Admin only' } })
    await useAdminStore.getState().fetchGrowthLevers()

    expect(useAdminStore.getState().growthLevers).toBeNull()
    expect(useAdminStore.getState().growthLeversError).toBeTruthy()
  })
})

describe('setAiFreeQuota', () => {
  it('sends the quota and re-reads the levers', async () => {
    happyPath()
    const res = await useAdminStore.getState().setAiFreeQuota(25)

    expect(res.error).toBeNull()
    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_set_ai_free_quota', {
      p_free_cards_per_day: 25,
    })
    expect(callsTo('admin_get_growth_levers')).toHaveLength(1)
  })

  it('does not re-read after a failed write', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'out of range' } })
    const res = await useAdminStore.getState().setAiFreeQuota(-1)

    expect(res.error).toBeTruthy()
    expect(callsTo('admin_get_growth_levers')).toHaveLength(0)
  })
})

describe('setCardLimit', () => {
  it('passes null for the field it is not changing, so COALESCE keeps it', async () => {
    happyPath()
    await useAdminStore.getState().setCardLimit(2500, null)

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_set_card_limit', {
      p_max_owned_cards: 2500,
      p_count_official: null,
    })
  })

  it('can toggle only the official-cards flag without touching the cap', async () => {
    happyPath()
    await useAdminStore.getState().setCardLimit(null, true)

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_set_card_limit', {
      p_max_owned_cards: null,
      p_count_official: true,
    })
  })

  it('sends false as false, not as null', async () => {
    // `?? null` on a boolean is the classic bug here: turning the flag OFF must
    // reach the RPC as false, otherwise COALESCE keeps it ON and the toggle
    // appears to do nothing.
    happyPath()
    await useAdminStore.getState().setCardLimit(null, false)

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_set_card_limit', {
      p_max_owned_cards: null,
      p_count_official: false,
    })
  })
})

describe('setAiPricing', () => {
  it('NEVER sends a usd_won_rate value — mig 149 pins it to 1', async () => {
    happyPath()
    await useAdminStore.getState().setAiPricing({ targetMarginBps: 6000 })

    const [, args] = callsTo('set_ai_pricing_settings')[0]
    expect(args.p_usd_won_rate).toBeNull()
    // And the untouched knob is left alone rather than rewritten.
    expect(args.p_won_per_credit).toBeNull()
    expect(args.p_target_margin_bps).toBe(6000)
  })

  it('sends only won_per_credit when only that changed', async () => {
    happyPath()
    await useAdminStore.getState().setAiPricing({ wonPerCredit: 300 })

    const [, args] = callsTo('set_ai_pricing_settings')[0]
    expect(args.p_won_per_credit).toBe(300)
    expect(args.p_target_margin_bps).toBeNull()
    expect(args.p_usd_won_rate).toBeNull()
  })

  it('re-reads so the form shows what the database now holds', async () => {
    const after = { ...LEVERS, target_margin_bps: 6000 }
    happyPath(after)
    await useAdminStore.getState().setAiPricing({ targetMarginBps: 6000 })

    expect(useAdminStore.getState().growthLevers?.target_margin_bps).toBe(6000)
  })

  it('returns the server message when the write is rejected', async () => {
    // e.g. target_margin_bps = 10000, which the RPC refuses because it is a
    // divisor in the charging formula.
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Invalid setting' } })
    const res = await useAdminStore.getState().setAiPricing({ targetMarginBps: 10000 })

    expect(res.error).toBeTruthy()
    expect(callsTo('admin_get_growth_levers')).toHaveLength(0)
  })
})

describe('audit trail', () => {
  it('logs every lever change', async () => {
    happyPath()
    await useAdminStore.getState().setAiFreeQuota(25)
    await useAdminStore.getState().setCardLimit(2500, null)
    await useAdminStore.getState().setAiPricing({ wonPerCredit: 300 })

    const logged = callsTo('admin_log_action').map((c) => c[1].p_action)
    expect(logged).toEqual(['set_ai_free_quota', 'set_card_limit', 'set_ai_pricing'])
  })
})
