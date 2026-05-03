/**
 * Deck-store: subscribed deck merge invariant
 *
 * Ensures that fetchDecks() picks up active subscribe-mode shares
 * and merges them into the deck list. This was previously bundled with
 * marketplace-acquire-refresh.test.ts but split out per single-responsibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
}))

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: () => mockGetUser() },
  rpc: vi.fn(),
  from: (...args: unknown[]) => mockFrom(...args),
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

import { useDeckStore } from '../deck-store'

function builder(value: { data: unknown; error: unknown }) {
  return new Proxy(
    {},
    {
      get: (_, prop) => {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(value)
        return () => builder(value)
      },
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
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

describe('useDeckStore.fetchDecks — subscription merge', () => {
  it('merges subscribed decks (via active deck_shares) into the deck list', async () => {
    const subscribed = { id: 'd-sub', name: 'Subscribed', user_id: 'owner-2', is_archived: false }
    let decksCall = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'decks') {
        decksCall++
        if (decksCall === 1) return builder({ data: [], error: null }) // own decks
        return builder({ data: [subscribed], error: null }) // subscribed decks
      }
      if (table === 'deck_shares') {
        return builder({ data: [{ deck_id: 'd-sub' }], error: null })
      }
      return builder({ data: [], error: null })
    })

    await act(async () => {
      await useDeckStore.getState().fetchDecks()
    })

    const decks = useDeckStore.getState().decks
    expect(decks).toHaveLength(1)
    expect(decks[0].id).toBe('d-sub')
  })
})
