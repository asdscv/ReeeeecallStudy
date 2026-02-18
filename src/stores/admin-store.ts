import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { validateAdminDays, extractErrorMessage } from '../lib/admin-stats'
import type {
  AdminOverviewStats,
  AdminActiveUsers,
  AdminUserSignup,
  AdminDailyStudyActivity,
  AdminModeBreakdown,
  AdminContentStats,
  AdminRatingDistribution,
  AdminRecentActivity,
  AdminSystemStats,
  AdminSrsStatusBreakdown,
  AdminRetentionMetrics,
  AdminContentsAnalytics,
} from '../types/database'

const CACHE_TTL = 5 * 60_000 // 5 minutes

type SectionKey = 'overview' | 'users' | 'study' | 'market' | 'contents' | 'system'

interface AdminState {
  // Overview
  overviewStats: AdminOverviewStats | null
  activeUsers: AdminActiveUsers | null
  recentActivity: AdminRecentActivity[]
  overviewLoading: boolean
  overviewError: string | null

  // Users
  userSignups: AdminUserSignup[]
  userList: { id: string; display_name: string | null; created_at: string; role: string }[]
  userListTotal: number
  retentionMetrics: AdminRetentionMetrics | null
  usersLoading: boolean
  usersError: string | null

  // Study Activity
  dailyActivity: AdminDailyStudyActivity[]
  modeBreakdown: AdminModeBreakdown[]
  ratingDistribution: AdminRatingDistribution[]
  srsBreakdown: AdminSrsStatusBreakdown[]
  studyLoading: boolean
  studyError: string | null

  // Market (was "content" — marketplace data)
  marketStats: AdminContentStats | null
  marketLoading: boolean
  marketError: string | null

  // Contents (actual content analytics)
  contentsAnalytics: AdminContentsAnalytics | null
  contentsLoading: boolean
  contentsError: string | null

  // System
  systemStats: AdminSystemStats | null
  systemLoading: boolean
  systemError: string | null

  // Cache timestamps
  _fetchedAt: Record<SectionKey, number>

  // Actions
  fetchOverview: () => Promise<void>
  fetchUsers: (page?: number, pageSize?: number) => Promise<void>
  fetchStudyActivity: (days?: number) => Promise<void>
  fetchMarket: () => Promise<void>
  fetchContents: () => Promise<void>
  fetchSystem: () => Promise<void>
}

function isFresh(fetchedAt: Record<SectionKey, number>, key: SectionKey): boolean {
  return Date.now() - fetchedAt[key] < CACHE_TTL
}

export const useAdminStore = create<AdminState>((set, get) => ({
  overviewStats: null,
  activeUsers: null,
  recentActivity: [],
  overviewLoading: false,
  overviewError: null,

  userSignups: [],
  userList: [],
  userListTotal: 0,
  retentionMetrics: null,
  usersLoading: false,
  usersError: null,

  dailyActivity: [],
  modeBreakdown: [],
  ratingDistribution: [],
  srsBreakdown: [],
  studyLoading: false,
  studyError: null,

  marketStats: null,
  marketLoading: false,
  marketError: null,

  contentsAnalytics: null,
  contentsLoading: false,
  contentsError: null,

  systemStats: null,
  systemLoading: false,
  systemError: null,

  _fetchedAt: { overview: 0, users: 0, study: 0, market: 0, contents: 0, system: 0 },

  fetchOverview: async () => {
    if (get().overviewLoading) return
    if (isFresh(get()._fetchedAt, 'overview') && get().overviewStats) return
    set({ overviewLoading: true, overviewError: null })
    try {
      const [overviewRes, activeRes, recentRes] = await Promise.all([
        supabase.rpc('admin_overview_stats'),
        supabase.rpc('admin_active_users'),
        supabase.rpc('admin_recent_activity'),
      ])

      if (overviewRes.error) throw overviewRes.error
      if (activeRes.error) throw activeRes.error
      if (recentRes.error) throw recentRes.error

      set({
        overviewStats: overviewRes.data as AdminOverviewStats | null,
        activeUsers: activeRes.data as AdminActiveUsers | null,
        recentActivity: (recentRes.data as AdminRecentActivity[] | null) ?? [],
        _fetchedAt: { ...get()._fetchedAt, overview: Date.now() },
      })
    } catch (e) {
      set({ overviewError: extractErrorMessage(e) })
    } finally {
      set({ overviewLoading: false })
    }
  },

  fetchUsers: async (page = 0, pageSize = 20) => {
    if (get().usersLoading) return
    // Users page always fetches for pagination, but skip chart data if fresh
    const chartsFresh = isFresh(get()._fetchedAt, 'users') && get().userSignups.length > 0
    set({ usersLoading: true, usersError: null })
    try {
      const promises: PromiseLike<unknown>[] = [
        supabase
          .from('profiles')
          .select('id, display_name, created_at, role')
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]

      if (!chartsFresh) {
        promises.push(
          supabase.rpc('admin_user_signups', { p_days: 90 }),
          supabase.rpc('admin_retention_metrics'),
        )
      }

      const results = await Promise.all(promises)

      const usersRes = results[0] as { data?: unknown[]; error?: unknown }
      const countRes = results[1] as { count: number | null; error: unknown }

      if (usersRes.error) throw usersRes.error
      if (countRes.error) throw countRes.error

      const profiles = (usersRes.data ?? []) as { id: string; display_name: string | null; created_at: string; role: string }[]

      const updates: Partial<AdminState> = {
        userList: profiles,
        userListTotal: countRes.count ?? 0,
      }

      if (!chartsFresh) {
        const signupsRes = results[2] as { data: unknown; error: unknown }
        const retentionRes = results[3] as { data: unknown; error: unknown }
        if (signupsRes.error) throw signupsRes.error
        if (retentionRes.error) throw retentionRes.error
        updates.userSignups = (signupsRes.data as AdminUserSignup[] | null) ?? []
        updates.retentionMetrics = retentionRes.data as AdminRetentionMetrics | null
        updates._fetchedAt = { ...get()._fetchedAt, users: Date.now() } as AdminState['_fetchedAt']
      }

      set(updates)
    } catch (e) {
      set({ usersError: extractErrorMessage(e) })
    } finally {
      set({ usersLoading: false })
    }
  },

  fetchStudyActivity: async (days = 30) => {
    if (get().studyLoading) return
    const safeDays = validateAdminDays(days)
    set({ studyLoading: true, studyError: null })
    try {
      const [activityRes, modeRes, ratingRes, srsRes] = await Promise.all([
        supabase.rpc('admin_daily_study_activity', { p_days: safeDays }),
        supabase.rpc('admin_mode_breakdown', { p_days: safeDays }),
        supabase.rpc('admin_rating_distribution', { p_days: safeDays }),
        supabase.rpc('admin_srs_status_breakdown'),
      ])

      if (activityRes.error) throw activityRes.error
      if (modeRes.error) throw modeRes.error
      if (ratingRes.error) throw ratingRes.error
      if (srsRes.error) throw srsRes.error

      set({
        dailyActivity: (activityRes.data as AdminDailyStudyActivity[] | null) ?? [],
        modeBreakdown: (modeRes.data as AdminModeBreakdown[] | null) ?? [],
        ratingDistribution: (ratingRes.data as AdminRatingDistribution[] | null) ?? [],
        srsBreakdown: (srsRes.data as AdminSrsStatusBreakdown[] | null) ?? [],
        _fetchedAt: { ...get()._fetchedAt, study: Date.now() },
      })
    } catch (e) {
      set({ studyError: extractErrorMessage(e) })
    } finally {
      set({ studyLoading: false })
    }
  },

  fetchMarket: async () => {
    if (get().marketLoading) return
    if (isFresh(get()._fetchedAt, 'market') && get().marketStats) return
    set({ marketLoading: true, marketError: null })
    try {
      const { data, error } = await supabase.rpc('admin_content_stats')
      if (error) throw error
      set({
        marketStats: data as AdminContentStats | null,
        _fetchedAt: { ...get()._fetchedAt, market: Date.now() },
      })
    } catch (e) {
      set({ marketError: extractErrorMessage(e) })
    } finally {
      set({ marketLoading: false })
    }
  },

  fetchContents: async () => {
    if (get().contentsLoading) return
    if (isFresh(get()._fetchedAt, 'contents') && get().contentsAnalytics) return
    set({ contentsLoading: true, contentsError: null })
    try {
      const { data, error } = await supabase.rpc('admin_content_analytics')
      if (error) throw error
      set({
        contentsAnalytics: data as AdminContentsAnalytics | null,
        _fetchedAt: { ...get()._fetchedAt, contents: Date.now() },
      })
    } catch (e) {
      set({ contentsError: extractErrorMessage(e) })
    } finally {
      set({ contentsLoading: false })
    }
  },

  fetchSystem: async () => {
    if (get().systemLoading) return
    if (isFresh(get()._fetchedAt, 'system') && get().systemStats) return
    set({ systemLoading: true, systemError: null })
    try {
      const { data, error } = await supabase.rpc('admin_system_stats')
      if (error) throw error
      set({
        systemStats: data as AdminSystemStats | null,
        _fetchedAt: { ...get()._fetchedAt, system: Date.now() },
      })
    } catch (e) {
      set({ systemError: extractErrorMessage(e) })
    } finally {
      set({ systemLoading: false })
    }
  },
}))
