import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { OfficialAccount, OfficialListing, BadgeType } from '../types/database'

interface OfficialState {
  officialAccounts: OfficialAccount[]
  officialListings: OfficialListing[]
  loading: boolean
  listingsLoading: boolean
  error: string | null

  fetchOfficialAccounts: () => Promise<void>
  fetchOfficialListings: (limit?: number) => Promise<void>
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

  fetchOfficialAccounts: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('get_official_accounts')
      if (error) throw error
      set({ officialAccounts: (data ?? []) as OfficialAccount[], loading: false })
    } catch (e) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: string }).message) : 'Failed to fetch official accounts'
      set({ error: msg, loading: false })
    }
  },

  fetchOfficialListings: async (limit = 20) => {
    if (get().listingsLoading) return
    set({ listingsLoading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('get_official_listings', {
        p_limit: limit,
      } as Record<string, unknown>)
      if (error) throw error
      set({ officialListings: (data ?? []) as OfficialListing[], listingsLoading: false })
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

      // Refresh the list
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

      await get().fetchOfficialAccounts()
      return { error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update settings'
      return { error: msg }
    }
  },

  reset: () =>
    set({
      officialAccounts: [],
      officialListings: [],
      loading: false,
      listingsLoading: false,
      error: null,
    }),
}))
