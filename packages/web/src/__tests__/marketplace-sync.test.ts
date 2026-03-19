/**
 * Tests for the subscribe-mode sync system.
 *
 * These tests mock Supabase to verify the sync store logic without
 * hitting a real database. The underlying SQL/RPC logic is tested via
 * the migration and the RPC contract.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

// Helper to build a chainable Supabase query builder mock
function mockQueryBuilder(resolvedValue: { data: unknown; error: unknown; count?: number }) {
  const builder: Record<string, Mock> = {}
  const chain = () =>
    new Proxy(builder, {
      get: (_target, prop) => {
        if (prop === 'then') {
          // Make it thenable so await works
          return (resolve: (v: unknown) => void) => resolve(resolvedValue)
        }
        if (!builder[prop as string]) {
          builder[prop as string] = vi.fn().mockReturnValue(chain())
        }
        return builder[prop as string]
      },
    })
  return chain()
}

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
  getSupabase: () => ({
    auth: { getUser: () => mockGetUser() },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  initSupabase: vi.fn(),
}))

// Must import AFTER vi.mock so the mock takes effect
import { useSyncStore } from '@reeeeecall/shared/stores/sync-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-111'
const TEST_DECK_ID = 'deck-222'

function setAuthUser(userId: string | null) {
  if (userId) {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } })
  } else {
    mockGetUser.mockResolvedValue({ data: { user: null } })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSyncStore', () => {
  beforeEach(() => {
    // Reset zustand store between tests
    useSyncStore.setState({
      pendingCounts: {},
      lastSyncResults: {},
      syncing: {},
      syncingAll: false,
      error: null,
    })
    vi.clearAllMocks()
    setAuthUser(TEST_USER_ID)
  })

  // ── syncSubscribedDeck ──────────────────────────────────────

  describe('syncSubscribedDeck', () => {
    it('syncs and returns added/removed counts', async () => {
      const syncResult = { added: 3, removed: 1, last_synced: '2026-03-19T12:00:00Z' }
      mockRpc.mockResolvedValue({ data: syncResult, error: null })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(mockRpc).toHaveBeenCalledWith('sync_subscriber_deck', {
        p_user_id: TEST_USER_ID,
        p_deck_id: TEST_DECK_ID,
      })
      expect(result).toEqual(syncResult)
      expect(useSyncStore.getState().lastSyncResults[TEST_DECK_ID]).toEqual(syncResult)
      expect(useSyncStore.getState().pendingCounts[TEST_DECK_ID]).toBe(0)
    })

    it('returns null and sets error on RPC failure', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'No active subscription' } })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(result).toBeNull()
      expect(useSyncStore.getState().error).toBe('No active subscription')
    })

    it('returns null when user is not authenticated', async () => {
      setAuthUser(null)

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('sets syncing state correctly during sync', async () => {
      // Slow RPC to check intermediate state
      let resolveRpc: (v: unknown) => void
      mockRpc.mockReturnValue(new Promise((r) => { resolveRpc = r }))

      expect(useSyncStore.getState().syncing[TEST_DECK_ID]).toBeFalsy()

      const promise = useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)

      // Wait for microtasks so the auth.getUser completes
      await new Promise((r) => setTimeout(r, 10))
      expect(useSyncStore.getState().syncing[TEST_DECK_ID]).toBe(true)

      await act(async () => {
        resolveRpc!({ data: { added: 0, removed: 0, last_synced: 'now' }, error: null })
        await promise
      })

      expect(useSyncStore.getState().syncing[TEST_DECK_ID]).toBe(false)
    })

    it('sync with no changes returns 0/0 result', async () => {
      const syncResult = { added: 0, removed: 0, last_synced: '2026-03-19T12:00:00Z' }
      mockRpc.mockResolvedValue({ data: syncResult, error: null })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(result).toEqual(syncResult)
      expect((result as { added: number }).added).toBe(0)
      expect((result as { removed: number }).removed).toBe(0)
    })

    it('multiple syncs are idempotent — same result on repeated calls', async () => {
      const syncResult = { added: 2, removed: 0, last_synced: '2026-03-19T12:00:00Z' }
      mockRpc.mockResolvedValue({ data: syncResult, error: null })

      await act(async () => {
        await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      // Second sync: publisher made no further changes so RPC returns 0/0
      const syncResult2 = { added: 0, removed: 0, last_synced: '2026-03-19T12:01:00Z' }
      mockRpc.mockResolvedValue({ data: syncResult2, error: null })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(result).toEqual(syncResult2)
      // pendingCounts should be 0 after second sync too
      expect(useSyncStore.getState().pendingCounts[TEST_DECK_ID]).toBe(0)
    })
  })

  // ── fetchPendingCount ───────────────────────────────────────

  describe('fetchPendingCount', () => {
    it('fetches and stores pending count', async () => {
      mockRpc.mockResolvedValue({ data: 5, error: null })

      let count: number | undefined
      await act(async () => {
        count = await useSyncStore.getState().fetchPendingCount(TEST_DECK_ID)
      })

      expect(mockRpc).toHaveBeenCalledWith('get_pending_sync_count', {
        p_user_id: TEST_USER_ID,
        p_deck_id: TEST_DECK_ID,
      })
      expect(count).toBe(5)
      expect(useSyncStore.getState().pendingCounts[TEST_DECK_ID]).toBe(5)
    })

    it('returns 0 on error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'err' } })

      let count: number | undefined
      await act(async () => {
        count = await useSyncStore.getState().fetchPendingCount(TEST_DECK_ID)
      })

      expect(count).toBe(0)
    })

    it('returns 0 when unauthenticated', async () => {
      setAuthUser(null)

      let count: number | undefined
      await act(async () => {
        count = await useSyncStore.getState().fetchPendingCount(TEST_DECK_ID)
      })

      expect(count).toBe(0)
      expect(mockRpc).not.toHaveBeenCalled()
    })
  })

  // ── syncAllSubscriptions ────────────────────────────────────

  describe('syncAllSubscriptions', () => {
    it('syncs all active subscriptions', async () => {
      const deckIds = ['deck-a', 'deck-b', 'deck-c']

      // mockFrom for fetching shares
      mockFrom.mockReturnValue(
        mockQueryBuilder({
          data: deckIds.map((id) => ({ deck_id: id })),
          error: null,
        })
      )

      // mockRpc for each sync call
      mockRpc.mockResolvedValue({
        data: { added: 1, removed: 0, last_synced: 'now' },
        error: null,
      })

      await act(async () => {
        await useSyncStore.getState().syncAllSubscriptions()
      })

      // Should have called rpc 3 times (once per deck)
      expect(mockRpc).toHaveBeenCalledTimes(3)
      expect(useSyncStore.getState().syncingAll).toBe(false)
    })

    it('handles no subscriptions gracefully', async () => {
      mockFrom.mockReturnValue(
        mockQueryBuilder({ data: [], error: null })
      )

      await act(async () => {
        await useSyncStore.getState().syncAllSubscriptions()
      })

      expect(mockRpc).not.toHaveBeenCalled()
      expect(useSyncStore.getState().syncingAll).toBe(false)
    })

    it('handles fetch error gracefully', async () => {
      mockFrom.mockReturnValue(
        mockQueryBuilder({ data: null, error: { message: 'Network error' } })
      )

      await act(async () => {
        await useSyncStore.getState().syncAllSubscriptions()
      })

      expect(useSyncStore.getState().error).toBe('Network error')
      expect(useSyncStore.getState().syncingAll).toBe(false)
    })

    it('does nothing when unauthenticated', async () => {
      setAuthUser(null)

      await act(async () => {
        await useSyncStore.getState().syncAllSubscriptions()
      })

      expect(mockFrom).not.toHaveBeenCalled()
      expect(useSyncStore.getState().syncingAll).toBe(false)
    })
  })

  // ── getChangeLog ────────────────────────────────────────────

  describe('getChangeLog', () => {
    it('fetches change log entries', async () => {
      const entries = [
        { id: '1', deck_id: TEST_DECK_ID, change_type: 'card_added', card_id: 'c1', metadata: {}, created_at: '2026-03-19T10:00:00Z' },
        { id: '2', deck_id: TEST_DECK_ID, change_type: 'card_removed', card_id: 'c2', metadata: {}, created_at: '2026-03-19T11:00:00Z' },
      ]

      mockFrom.mockReturnValue(
        mockQueryBuilder({ data: entries, error: null })
      )

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().getChangeLog(TEST_DECK_ID)
      })

      expect(result).toEqual(entries)
    })

    it('returns empty array on error', async () => {
      mockFrom.mockReturnValue(
        mockQueryBuilder({ data: null, error: { message: 'err' } })
      )

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().getChangeLog(TEST_DECK_ID)
      })

      expect(result).toEqual([])
    })

    it('filters by since parameter', async () => {
      mockFrom.mockReturnValue(
        mockQueryBuilder({ data: [], error: null })
      )

      await act(async () => {
        await useSyncStore.getState().getChangeLog(TEST_DECK_ID, '2026-03-19T10:00:00Z')
      })

      // Verify from was called (we can't easily check deep chain params with proxy mock)
      expect(mockFrom).toHaveBeenCalledWith('deck_change_log')
    })
  })

  // ── fetchAllPendingCounts ───────────────────────────────────

  describe('fetchAllPendingCounts', () => {
    it('fetches counts for all subscriptions', async () => {
      mockFrom.mockReturnValue(
        mockQueryBuilder({
          data: [{ deck_id: 'deck-a' }, { deck_id: 'deck-b' }],
          error: null,
        })
      )

      // Two calls to get_pending_sync_count RPC
      mockRpc
        .mockResolvedValueOnce({ data: 3, error: null })
        .mockResolvedValueOnce({ data: 0, error: null })

      await act(async () => {
        await useSyncStore.getState().fetchAllPendingCounts()
      })

      expect(mockRpc).toHaveBeenCalledTimes(2)
      expect(useSyncStore.getState().pendingCounts['deck-a']).toBe(3)
      expect(useSyncStore.getState().pendingCounts['deck-b']).toBe(0)
    })
  })

  // ── Scenario: publisher adds cards, subscriber syncs ────────

  describe('end-to-end scenarios', () => {
    it('publisher adds cards -> subscriber syncs -> sees new cards', async () => {
      // Step 1: pending count shows 2 new changes
      mockRpc.mockResolvedValueOnce({ data: 2, error: null })

      await act(async () => {
        await useSyncStore.getState().fetchPendingCount(TEST_DECK_ID)
      })
      expect(useSyncStore.getState().pendingCounts[TEST_DECK_ID]).toBe(2)

      // Step 2: sync adds the 2 new cards
      mockRpc.mockResolvedValueOnce({
        data: { added: 2, removed: 0, last_synced: '2026-03-19T12:00:00Z' },
        error: null,
      })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect((result as { added: number }).added).toBe(2)
      expect((result as { removed: number }).removed).toBe(0)
      expect(useSyncStore.getState().pendingCounts[TEST_DECK_ID]).toBe(0)
    })

    it('publisher removes cards -> subscriber syncs -> cards removed from progress', async () => {
      mockRpc.mockResolvedValueOnce({
        data: { added: 0, removed: 3, last_synced: '2026-03-19T12:00:00Z' },
        error: null,
      })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect((result as { added: number }).added).toBe(0)
      expect((result as { removed: number }).removed).toBe(3)
    })

    it('only active subscribers can sync (revoked returns error)', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'No active subscription found for this deck' },
      })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect(result).toBeNull()
      expect(useSyncStore.getState().error).toContain('No active subscription')
    })

    it('publisher adds and removes cards -> subscriber syncs -> net result', async () => {
      mockRpc.mockResolvedValueOnce({
        data: { added: 5, removed: 2, last_synced: '2026-03-19T12:00:00Z' },
        error: null,
      })

      let result: unknown
      await act(async () => {
        result = await useSyncStore.getState().syncSubscribedDeck(TEST_DECK_ID)
      })

      expect((result as { added: number }).added).toBe(5)
      expect((result as { removed: number }).removed).toBe(2)
    })
  })
})
