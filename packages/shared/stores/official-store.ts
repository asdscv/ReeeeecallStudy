import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { createStaleCache } from '../lib/cache/stale-cache'
import type { OfficialAccount, OfficialListing, BadgeType } from '../types/database'

// Official accounts/listings are admin-curated, read-only for normal viewers and
// benign to serve slightly stale → TTL-cache the reads so MarketplacePage /
// AdminOfficialPage don't refetch on every mount. Admin mutations invalidate.
const officialCache = createStaleCache({ ttlMs: 5 * 60 * 1000 })

interface OfficialState {
  officialAccounts: OfficialAccount[]
  officialListings: OfficialListing[]
  loading: boolean
  listingsLoading: boolean
  error: string | null

  fetchOfficialAccounts: (opts?: { force?: boolean }) => Promise<void>
  fetchOfficialListings: (limit?: number, opts?: { force?: boolean }) => Promise<void>
  setOfficialStatus: (
    userId: string,
    isOfficial: boolean,
    badgeType?: BadgeType,
    orgName?: string,
  ) => Promise<{ error: string | null }>
  updateOfficialSettings: (
    userId: string,
    settings: {
      badgeType?: BadgeType
      badgeColor?: string
      organizationName?: string
      organizationUrl?: string
      featuredPriority?: number
      maxListings?: number
      canFeatureListings?: boolean
    },
  ) => Promise<{ error: string | null }>
  reset: () => void
}

export const useOfficialStore = create<OfficialState>((set, get) => ({
  officialAccounts: [],
  officialListings: [],
  loading: false,
  listingsLoading: false,
  error: null,

  fetchOfficialAccounts: async (opts) => {
    if (get().loading) return
    if (!officialCache.shouldFetch('accounts', opts)) return
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('get_official_accounts')
      if (error) throw error
      set({ officialAccounts: (data ?? []) as OfficialAccount[], loading: false })
      officialCache.markFetched('accounts')
    } catch (e) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: string }).message) : 'Failed to fetch official accounts'
      set({ error: msg, loading: false })
    }
  },

  fetchOfficialListings: async (limit = 20, opts) => {
    if (get().listingsLoading) return
    if (!officialCache.shouldFetch('listings', opts)) return
    set({ listingsLoading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('get_official_listings', {
        p_limit: limit,
      } as Record<string, unknown>)
      if (error) throw error
      set({ officialListings: (data ?? []) as OfficialListing[], listingsLoading: false })
      officialCache.markFetched('listings')
    } catch (e) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: string }).message) : 'Failed to fetch official listings'
      set({ error: msg, listingsLoading: false })
    }
  },

  setOfficialStatus: async (userId, isOfficial, badgeType = 'verified', orgName) => {
    try {
      const { error } = await supabase.rpc('admin_set_official', {
        p_user_id: userId,
        p_is_official: isOfficial,
        p_badge_type: badgeType,
        p_org_name: orgName ?? null,
      } as Record<string, unknown>)

      if (error) {
        const msg = error.message || 'Failed to set official status'
        return { error: msg }
      }

      // Admin change → invalidate cached reads so the refresh actually hits the
      // network and the marketplace's official badges/listings reflect it.
      officialCache.invalidate('accounts')
      officialCache.invalidate('listings')
      await get().fetchOfficialAccounts()
      return { error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to set official status'
      return { error: msg }
    }
  },

  updateOfficialSettings: async (userId, settings) => {
    try {
      const { error } = await supabase.rpc('admin_update_official_settings', {
        p_user_id: userId,
        p_badge_type: settings.badgeType ?? null,
        p_badge_color: settings.badgeColor ?? null,
        p_organization_name: settings.organizationName ?? null,
        p_organization_url: settings.organizationUrl ?? null,
        p_featured_priority: settings.featuredPriority ?? null,
        p_max_listings: settings.maxListings ?? null,
        p_can_feature_listings: settings.canFeatureListings ?? null,
      } as Record<string, unknown>)

      if (error) {
        const msg = error.message || 'Failed to update settings'
        return { error: msg }
      }

      officialCache.invalidate('accounts')
      officialCache.invalidate('listings')
      await get().fetchOfficialAccounts()
      return { error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update settings'
      return { error: msg }
    }
  },

  reset: () => {
    officialCache.invalidate()
    set({
      officialAccounts: [],
      officialListings: [],
      loading: false,
      listingsLoading: false,
      error: null,
    })
  },
}))
