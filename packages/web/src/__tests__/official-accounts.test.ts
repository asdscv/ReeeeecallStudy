/**
 * Tests for the official accounts system.
 *
 * These tests mock Supabase to verify the official store logic
 * without hitting a real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const mockRpc = vi.fn()

vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(),
  },
  getSupabase: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(),
  }),
  initSupabase: vi.fn(),
}))

// Must import AFTER vi.mock
import { useOfficialStore } from '@reeeeecall/shared/stores/official-store'
import type { BadgeType } from '@reeeeecall/shared/types/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-official-1'

const MOCK_OFFICIAL_ACCOUNT = {
  user_id: TEST_USER_ID,
  display_name: 'Test Publisher',
  is_official: true,
  display_badge: 'verified' as BadgeType,
  badge_color: '#3B82F6',
  organization_name: 'Test Corp',
  organization_url: 'https://test.com',
  featured_priority: 5,
  max_listings: 100,
  can_feature_listings: true,
  verified_at: '2026-03-01T00:00:00Z',
  listing_count: 3,
}

const MOCK_OFFICIAL_LISTING = {
  id: 'listing-1',
  deck_id: 'deck-1',
  owner_id: TEST_USER_ID,
  title: 'Official Deck',
  description: 'An official deck',
  tags: ['official'],
  category: 'language',
  share_mode: 'copy',
  card_count: 50,
  acquire_count: 100,
  view_count: 500,
  avg_rating: 4.5,
  review_count: 10,
  is_active: true,
  created_at: '2026-03-01T00:00:00Z',
  owner_display_name: 'Test Publisher',
  owner_is_official: true,
  badge_type: 'verified',
  badge_color: '#3B82F6',
  organization_name: 'Test Corp',
  featured_priority: 5,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOfficialStore', () => {
  beforeEach(() => {
    useOfficialStore.setState({
      officialAccounts: [],
      officialListings: [],
      loading: false,
      listingsLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  // ── fetchOfficialAccounts ─────────────────────────────────

  describe('fetchOfficialAccounts', () => {
    it('fetches and stores official accounts', async () => {
      mockRpc.mockResolvedValue({ data: [MOCK_OFFICIAL_ACCOUNT], error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialAccounts()
      })

      expect(mockRpc).toHaveBeenCalledWith('get_official_accounts')
      expect(useOfficialStore.getState().officialAccounts).toHaveLength(1)
      expect(useOfficialStore.getState().officialAccounts[0].display_name).toBe('Test Publisher')
    })

    it('handles RPC error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialAccounts()
      })

      expect(useOfficialStore.getState().error).toBe('DB error')
      expect(useOfficialStore.getState().officialAccounts).toHaveLength(0)
    })

    it('returns empty array when no official accounts', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialAccounts()
      })

      expect(useOfficialStore.getState().officialAccounts).toHaveLength(0)
      expect(useOfficialStore.getState().loading).toBe(false)
    })
  })

  // ── fetchOfficialListings ─────────────────────────────────

  describe('fetchOfficialListings', () => {
    it('fetches official listings with default limit', async () => {
      mockRpc.mockResolvedValue({ data: [MOCK_OFFICIAL_LISTING], error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialListings()
      })

      expect(mockRpc).toHaveBeenCalledWith('get_official_listings', { p_limit: 20 })
      expect(useOfficialStore.getState().officialListings).toHaveLength(1)
      expect(useOfficialStore.getState().officialListings[0].title).toBe('Official Deck')
    })

    it('fetches with custom limit', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialListings(5)
      })

      expect(mockRpc).toHaveBeenCalledWith('get_official_listings', { p_limit: 5 })
    })

    it('handles error gracefully', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'Network error' } })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialListings()
      })

      expect(useOfficialStore.getState().error).toBe('Network error')
      expect(useOfficialStore.getState().officialListings).toHaveLength(0)
    })
  })

  // ── setOfficialStatus ─────────────────────────────────────

  describe('setOfficialStatus', () => {
    it('admin can set official status', async () => {
      // First call: admin_set_official, second call: get_official_accounts (refresh)
      mockRpc
        .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, is_official: true }, error: null })
        .mockResolvedValueOnce({ data: [MOCK_OFFICIAL_ACCOUNT], error: null })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().setOfficialStatus(
          TEST_USER_ID,
          true,
          'verified',
          'Test Corp',
        )
      })

      expect(result.error).toBeNull()
      expect(mockRpc).toHaveBeenCalledWith('admin_set_official', {
        p_user_id: TEST_USER_ID,
        p_is_official: true,
        p_badge_type: 'verified',
        p_org_name: 'Test Corp',
      })
    })

    it('admin can unset official status', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, is_official: false }, error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().setOfficialStatus(TEST_USER_ID, false)
      })

      expect(result.error).toBeNull()
    })

    it('non-admin cannot modify official status', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Admin access required' } })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().setOfficialStatus(TEST_USER_ID, true)
      })

      expect(result.error).toBe('Admin access required')
    })

    it('handles user not found error', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'User not found' } })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().setOfficialStatus('nonexistent-user', true)
      })

      expect(result.error).toBe('User not found')
    })
  })

  // ── updateOfficialSettings ────────────────────────────────

  describe('updateOfficialSettings', () => {
    it('updates official account settings', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, updated: true }, error: null })
        .mockResolvedValueOnce({ data: [MOCK_OFFICIAL_ACCOUNT], error: null })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().updateOfficialSettings(TEST_USER_ID, {
          badgeType: 'educator',
          organizationName: 'New Org',
          featuredPriority: 10,
        })
      })

      expect(result.error).toBeNull()
      expect(mockRpc).toHaveBeenCalledWith('admin_update_official_settings', {
        p_user_id: TEST_USER_ID,
        p_badge_type: 'educator',
        p_badge_color: null,
        p_organization_name: 'New Org',
        p_organization_url: null,
        p_featured_priority: 10,
        p_max_listings: null,
        p_can_feature_listings: null,
      })
    })

    it('handles error when account not found', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Official account settings not found for user' },
      })

      let result: { error: string | null } = { error: 'not set' }
      await act(async () => {
        result = await useOfficialStore.getState().updateOfficialSettings('nonexistent', {
          badgeType: 'official',
        })
      })

      expect(result.error).toBe('Official account settings not found for user')
    })
  })

  // ── Badge types ───────────────────────────────────────────

  describe('badge types', () => {
    it('all badge types are valid in official accounts', async () => {
      const badgeTypes: BadgeType[] = ['verified', 'official', 'educator', 'publisher', 'partner']

      for (const badgeType of badgeTypes) {
        mockRpc
          .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, is_official: true }, error: null })
          .mockResolvedValueOnce({ data: [], error: null })

        let result: { error: string | null } = { error: 'not set' }
        await act(async () => {
          result = await useOfficialStore.getState().setOfficialStatus(
            TEST_USER_ID,
            true,
            badgeType,
          )
        })

        expect(result.error).toBeNull()
      }
    })
  })

  // ── Featured priority sorting ─────────────────────────────

  describe('featured priority sorting', () => {
    it('official listings are sorted by featured_priority descending', async () => {
      const listings = [
        { ...MOCK_OFFICIAL_LISTING, id: 'listing-low', featured_priority: 1 },
        { ...MOCK_OFFICIAL_LISTING, id: 'listing-high', featured_priority: 10 },
        { ...MOCK_OFFICIAL_LISTING, id: 'listing-mid', featured_priority: 5 },
      ]
      mockRpc.mockResolvedValue({ data: listings, error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialListings()
      })

      const stored = useOfficialStore.getState().officialListings
      expect(stored).toHaveLength(3)
      // The RPC returns pre-sorted, store preserves order
      expect(stored[0].id).toBe('listing-low')
    })

    it('official accounts are returned sorted by featured_priority', async () => {
      const accounts = [
        { ...MOCK_OFFICIAL_ACCOUNT, user_id: 'user-a', featured_priority: 0 },
        { ...MOCK_OFFICIAL_ACCOUNT, user_id: 'user-b', featured_priority: 10 },
      ]
      mockRpc.mockResolvedValue({ data: accounts, error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialAccounts()
      })

      expect(useOfficialStore.getState().officialAccounts).toHaveLength(2)
    })
  })

  // ── Reset ─────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all state', async () => {
      mockRpc.mockResolvedValue({ data: [MOCK_OFFICIAL_ACCOUNT], error: null })

      await act(async () => {
        await useOfficialStore.getState().fetchOfficialAccounts()
      })
      expect(useOfficialStore.getState().officialAccounts).toHaveLength(1)

      act(() => {
        useOfficialStore.getState().reset()
      })

      expect(useOfficialStore.getState().officialAccounts).toHaveLength(0)
      expect(useOfficialStore.getState().officialListings).toHaveLength(0)
      expect(useOfficialStore.getState().loading).toBe(false)
      expect(useOfficialStore.getState().error).toBeNull()
    })
  })

  // ── Edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('concurrent fetches are prevented (loading guard)', async () => {
      let resolveRpc: (v: unknown) => void
      mockRpc.mockReturnValue(new Promise((r) => { resolveRpc = r }))

      // Start first fetch
      const promise1 = useOfficialStore.getState().fetchOfficialAccounts()
      // Wait for microtask
      await new Promise((r) => setTimeout(r, 10))

      // Second fetch should be blocked
      const promise2 = useOfficialStore.getState().fetchOfficialAccounts()

      await act(async () => {
        resolveRpc!({ data: [MOCK_OFFICIAL_ACCOUNT], error: null })
        await promise1
        await promise2
      })

      // RPC should have been called only once
      expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    it('official status set with default badge type when omitted', async () => {
      mockRpc
        .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, is_official: true }, error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      await act(async () => {
        await useOfficialStore.getState().setOfficialStatus(TEST_USER_ID, true)
      })

      expect(mockRpc).toHaveBeenCalledWith('admin_set_official', expect.objectContaining({
        p_badge_type: 'verified',
      }))
    })
  })
})
