/**
 * TDD: marketplace acquireDeck — atomic + idempotent contract
 *
 * 표준: DOCS/DESIGN/MARKETPLACE_ACQUIRE/DESIGN.md §5.1
 *
 * Invariants under test:
 *   T1) 신규 subscribe acquire — RPC 1회, wasNew=true, cache invalidated
 *   T2) 신규 copy acquire     — RPC 1회, deckId === new copied id
 *   T3) 중복 acquire (이미 보유) — RPC 1회, wasNew=false, cache 유지
 *   T4) RPC P0001 (own listing) — result null, cache 유지, error set
 *   T5) RPC P0002 (not found)   — result null, cache 유지, error set
 *   T6) RPC network error       — result null, cache 유지
 *   T7) 동시 더블탭 (Promise.all 2회) — 둘 다 동일 deckId
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act } from '@testing-library/react'

const { mockRpc, mockGetUser } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetUser: vi.fn(),
}))

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: () => mockGetUser() },
  rpc: (...args: unknown[]) => mockRpc(...args),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabase: () => mockSupabase,
  initSupabase: vi.fn(),
}))
vi.mock('../../lib/rate-limit-instance', () => ({
  guard: { check: () => ({ allowed: true }), recordSuccess: vi.fn() },
}))
vi.mock('@reeeeecall/shared/lib/rate-limit-instance', () => ({
  guard: { check: () => ({ allowed: true }), recordSuccess: vi.fn() },
}))

import { useMarketplaceStore } from '../marketplace-store'
import { useDeckStore } from '../deck-store'

const USER_ID = 'user-1'
const LISTING_ID = 'listing-abc'
const DECK_ID = 'deck-xyz'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  useMarketplaceStore.setState({
    listings: [],
    myListings: [],
    loading: false,
    error: null,
    filters: { sortBy: 'newest' },
  })
  useDeckStore.setState({
    decks: [],
    stats: [],
    templates: [],
    loading: false,
    error: null,
    decksFetchedAt: null,
    statsFetchedAt: null,
    templatesFetchedAt: null,
  })
})

describe('acquireDeck — atomic single-RPC contract', () => {
  it('T1: subscribe — calls acquire_listing once, wasNew=true, invalidates cache', async () => {
    useDeckStore.setState({ decksFetchedAt: Date.now() - 60_000 })

    mockRpc.mockResolvedValue({
      data: [{ acquired_deck_id: DECK_ID, is_new_acquisition: true }],
      error: null,
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toEqual({ deckId: DECK_ID, wasNew: true })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('acquire_listing', { p_listing_id: LISTING_ID })
    expect(useDeckStore.getState().decksFetchedAt).toBeNull()
  })

  it('T2: copy — RPC returns new copied deck id', async () => {
    const NEW_DECK = 'copied-deck-123'
    mockRpc.mockResolvedValue({
      data: [{ acquired_deck_id: NEW_DECK, is_new_acquisition: true }],
      error: null,
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toEqual({ deckId: NEW_DECK, wasNew: true })
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('T3: idempotent — already acquired returns wasNew=false, does NOT invalidate cache', async () => {
    const cachedAt = Date.now() - 60_000
    useDeckStore.setState({ decksFetchedAt: cachedAt })

    mockRpc.mockResolvedValue({
      data: [{ acquired_deck_id: DECK_ID, is_new_acquisition: false }],
      error: null,
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toEqual({ deckId: DECK_ID, wasNew: false })
    expect(useDeckStore.getState().decksFetchedAt).toBe(cachedAt)
  })

  it('T4: P0001 own-listing — result null, cache unchanged, error set', async () => {
    const cachedAt = Date.now() - 60_000
    useDeckStore.setState({ decksFetchedAt: cachedAt })

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Cannot acquire own listing', hint: 'cannot_acquire_own' },
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toBeNull()
    expect(useDeckStore.getState().decksFetchedAt).toBe(cachedAt)
    expect(useMarketplaceStore.getState().error).toBeTruthy()
  })

  it('T5: P0002 not-found — result null, cache unchanged', async () => {
    const cachedAt = Date.now() - 60_000
    useDeckStore.setState({ decksFetchedAt: cachedAt })

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'Listing not found', hint: 'listing_not_found' },
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toBeNull()
    expect(useDeckStore.getState().decksFetchedAt).toBe(cachedAt)
  })

  it('T6: network/unknown error — result null, cache unchanged', async () => {
    const cachedAt = Date.now() - 60_000
    useDeckStore.setState({ decksFetchedAt: cachedAt })

    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'fetch failed' },
    })

    let result: { deckId: string; wasNew: boolean } | null = null
    await act(async () => {
      result = await useMarketplaceStore.getState().acquireDeck(LISTING_ID)
    })

    expect(result).toBeNull()
    expect(useDeckStore.getState().decksFetchedAt).toBe(cachedAt)
  })

  it('T7: concurrent double-tap — both calls resolve with same deck_id', async () => {
    // 두 번째 호출은 was_new=false 로 멱등 응답
    let call = 0
    mockRpc.mockImplementation(() => {
      call++
      return Promise.resolve({
        data: [{ acquired_deck_id: DECK_ID, is_new_acquisition: call === 1 }],
        error: null,
      })
    })

    const [r1, r2] = await act(async () =>
      Promise.all([
        useMarketplaceStore.getState().acquireDeck(LISTING_ID),
        useMarketplaceStore.getState().acquireDeck(LISTING_ID),
      ]),
    )

    expect(r1?.deckId).toBe(DECK_ID)
    expect(r2?.deckId).toBe(DECK_ID)
    // 정확히 하나만 wasNew=true
    expect([r1?.wasNew, r2?.wasNew].filter(Boolean)).toHaveLength(1)
  })
})
