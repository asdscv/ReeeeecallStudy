/**
 * Phase-2 cache: marketplace browse listings are TTL-cached so re-opening the
 * catalog does not refetch every active listing. Verifies the store wires the
 * shared stale-cache correctly (skip within TTL, force bypasses). The cache
 * logic itself is unit-tested in stale-cache.test.ts; invalidation on
 * publish/unpublish is a direct `listingsCache.invalidate('listings')` call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

const listingsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [{ id: 'l1', is_active: true, profiles: null }], error: null }),
}

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  rpc: vi.fn(),
  from: (...a: unknown[]) => mockFrom(...a),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase, getSupabase: () => mockSupabase, initSupabase: vi.fn(),
}))

import { useMarketplaceStore } from '../marketplace-store'

beforeEach(async () => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(listingsChain)
  useMarketplaceStore.setState({ listings: [], myListings: [], loading: false, error: null, filters: { sortBy: 'newest' } })
  // Establish a known-fresh cache, then clear call counts so each test measures its own delta.
  await useMarketplaceStore.getState().fetchListings({ force: true })
  mockFrom.mockClear()
})

describe('marketplace fetchListings — TTL cache', () => {
  it('skips the network when called again within the TTL', async () => {
    await useMarketplaceStore.getState().fetchListings()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('refetches when force is passed (pull-to-refresh)', async () => {
    await useMarketplaceStore.getState().fetchListings({ force: true })
    expect(mockFrom).toHaveBeenCalledWith('marketplace_listings')
  })

  it('still serves the cached listings to the store without a refetch', async () => {
    await useMarketplaceStore.getState().fetchListings()
    expect(useMarketplaceStore.getState().listings).toHaveLength(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
