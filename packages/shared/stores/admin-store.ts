import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { validateAdminDays, extractErrorMessage } from '../lib/admin-stats'
import { createStaleCache } from '../lib/cache/stale-cache'
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
  AdminPageViewsAnalytics,
  AdminAuditLog,
} from '../types/database'

// Per-section TTL cache (unified on the shared util — replaces the former private
// `_fetchedAt` map + `isFresh`). Freshness is not render state → lives outside the store.
const adminCache = createStaleCache({ ttlMs: 5 * 60_000 })

type SectionKey = 'overview' | 'users' | 'study' | 'market' | 'contents' | 'pageViews' | 'system' | 'audit' | 'billing'

// ── Billing (mig 122 admin_* RPCs) — snake_case JSON shapes ─────────────────
export interface AdminBillingOverview {
  active_subscriptions: number
  canceling: number
  past_due: number
  mrr_micro_won: number
  wallet_total_micro: number
  paid_revenue_30d_micro: number
  refunds_30d: number
}

/**
 * Sales channel of a billing row (mig 156). `provider` is NOT enough: RevenueCat
 * fronts both stores under provider='revenuecat', and they differ in the one way
 * that matters to an admin — whether WE can issue the money refund.
 *   web_lemonsqueezy / web_toss / android → yes, via API
 *   ios                                   → no; Apple alone issues App Store refunds
 *   mobile_unknown                        → row predates mig 156; treated as ios
 */
export type BillingChannel =
  | 'web_lemonsqueezy' | 'web_toss' | 'ios' | 'android' | 'mobile_unknown' | 'admin'

export type BillingPlatform = 'web' | 'ios' | 'android'

export interface AdminSubscriptionRow {
  id: string
  user_id: string
  email: string | null
  tier: string
  status: string
  card_limit: number | null
  provider: string | null
  provider_subscription_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
  platform: BillingPlatform | null
  channel: BillingChannel
  /** Server's verdict on whether a real money refund is possible for this channel. */
  can_refund_money: boolean
  /** 'sandbox' rows are test purchases — never counted as revenue (mig 159). */
  environment: 'production' | 'sandbox'
}

export interface AdminPaymentRow {
  merchant_uid: string
  user_id: string
  email: string | null
  product_id: string | null
  kind: string
  amount_krw: number
  /** Charged amount in micro-USD (mig 147); format with formatUsdMicro. */
  amount_micro: number
  status: string
  provider: string | null
  provider_payment_id: string | null
  paid_at: string | null
  created_at: string
  platform: BillingPlatform | null
  channel: BillingChannel
  can_refund_money: boolean
  environment: 'production' | 'sandbox'
}

/**
 * What admin-refund actually did. `providerRefunded` is the ONLY truth about money:
 * an iOS row returns ok:true with providerRefunded:false because access was revoked
 * but Apple — not us — issues the refund. Rendering a 200 as "refunded" would tell
 * the admin a customer was paid back when they were not.
 */
export interface RefundResult {
  ok: boolean
  kind: string
  provider: string | null
  channel: BillingChannel
  platform: BillingPlatform | null
  providerRefunded: boolean
  provider_result?: { note?: string; skipped?: boolean } & Record<string, unknown>
  internal?: unknown
  note?: string
}

/**
 * Policy verdict from refund_eligibility (mig 157). Advisory: it never blocks a
 * refund, because statutory cooling-off rights can override it.
 */
export interface RefundEligibility {
  ok: boolean
  eligible: boolean
  reason_code:
    | 'eligible' | 'not_found' | 'not_paid' | 'already_refunded'
    | 'outside_window' | 'already_used' | 'renewal_charge'
  kind?: string
  platform?: BillingPlatform | null
  channel?: BillingChannel
  can_refund_money?: boolean
  purchased_at?: string | null
  days_since?: number | null
  window_days?: number
  within_window?: boolean
  unused?: boolean
  /** False ⇒ the buyer was never shown the withdrawal-right notice; treat 'already_used' as advisory. */
  consent_recorded?: boolean
  detail?: Record<string, unknown>
  statutory_note?: string | null
}

export interface AdminUserBillingSubscription {
  id: string
  user_id: string
  product_id: string | null
  tier: string
  status: string
  card_limit: number | null
  provider: string | null
  provider_ref: string | null
  provider_subscription_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserBillingLedgerEntry {
  delta: number
  reason: string
  balance_after: number
  created_at: string
}

export interface AdminUserBillingPayment {
  merchant_uid: string
  product_id: string | null
  kind: string
  amount_krw: number
  /** Charged amount in micro-USD (mig 147); format with formatUsdMicro. */
  amount_micro: number
  status: string
  paid_at: string | null
  created_at: string
}

export interface AdminUserBilling {
  subscription: AdminUserBillingSubscription | null
  wallet_micro: number
  ledger: AdminUserBillingLedgerEntry[]
  payments: AdminUserBillingPayment[]
}

type UserStatus = 'active' | 'suspended' | 'banned'

interface AuditFilters {
  action?: string
  targetType?: string
  fromDate?: string
  toDate?: string
}

interface AdminState {
  // Overview
  overviewStats: AdminOverviewStats | null
  activeUsers: AdminActiveUsers | null
  recentActivity: AdminRecentActivity[]
  overviewLoading: boolean
  overviewError: string | null

  // Users
  userSignups: AdminUserSignup[]
  userList: { id: string; display_name: string | null; created_at: string; role: string; is_official: boolean; user_status?: UserStatus }[]
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

  // Page Views
  pageViewsAnalytics: AdminPageViewsAnalytics | null
  pageViewsLoading: boolean
  pageViewsError: string | null

  // System
  systemStats: AdminSystemStats | null
  systemLoading: boolean
  systemError: string | null
  systemFlags: SystemFlags | null

  // Audit Log
  auditLogs: AdminAuditLog[]
  auditTotal: number
  auditLoading: boolean
  auditError: string | null

  // Billing
  billingOverview: AdminBillingOverview | null
  billingSubscriptions: AdminSubscriptionRow[]
  billingPayments: AdminPaymentRow[]
  /** The last payments page came back FULL → at least one more page exists. Derived from
   *  the raw RPC row count, not billingPayments.length, which de-dupes on append. */
  billingPaymentsHasMore: boolean
  billingUser: AdminUserBilling | null
  billingOverviewLoading: boolean
  billingSubsLoading: boolean
  billingPaymentsLoading: boolean
  billingUserLoading: boolean
  billingError: string | null
  billingUserError: string | null

  // Actions
  fetchOverview: () => Promise<void>
  fetchUsers: (page?: number, pageSize?: number, filters?: { search?: string; role?: string; official?: boolean }) => Promise<void>
  fetchStudyActivity: (days?: number) => Promise<void>
  fetchMarket: () => Promise<void>
  fetchContents: () => Promise<void>
  fetchPageViews: () => Promise<void>
  fetchSystem: () => Promise<void>
  setOfficialStatus: (userId: string, isOfficial: boolean) => Promise<{ error: string | null }>
  setUserRole: (userId: string, role: 'user' | 'admin') => Promise<{ error: string | null }>
  setUserStatus: (userId: string, status: UserStatus) => Promise<{ error: string | null }>
  fetchAuditLogs: (page?: number, pageSize?: number, filters?: AuditFilters) => Promise<void>
  logAction: (action: string, targetType: string, targetId?: string, details?: Record<string, unknown>) => Promise<void>
  // Billing
  fetchBillingOverview: () => Promise<void>
  fetchBillingSubscriptions: (status?: string, page?: number, pageSize?: number) => Promise<void>
  /** `append` keeps the rows already loaded and adds the page after them (load-more
   *  list) instead of replacing them (page-flip). `platform` narrows the list to one
   *  sales channel ('web' | 'ios' | 'android'); omit for all channels. */
  fetchBillingPayments: (page?: number, pageSize?: number, append?: boolean, platform?: BillingPlatform | null) => Promise<void>
  fetchUserBilling: (userId: string) => Promise<void>
  clearUserBilling: () => void
  cancelSubscription: (provider: string, providerSubscriptionId: string, immediate: boolean) => Promise<{ error: string | null }>
  grantSubscription: (userId: string, productId: string, periodEnd: string | null) => Promise<{ error: string | null }>
  adjustWallet: (userId: string, deltaMicro: number, reason: string) => Promise<{ error: string | null }>
  refundPayment: (kind: 'credit_pack' | 'subscription', ref: string, reason?: string) => Promise<{ error: string | null; result?: RefundResult }>
  /** Policy verdict for a would-be refund (mig 157). Advisory — never blocks. */
  checkRefundEligibility: (kind: 'credit_pack' | 'subscription', ref: string) => Promise<{ error: string | null; eligibility?: RefundEligibility }>
  // System flags / kill switches (mig 153)
  fetchSystemFlags: () => Promise<void>
  setSystemFlags: (patch: Partial<SystemFlags>) => Promise<{ error: string | null }>
  setListingActive: (listingId: string, active: boolean) => Promise<{ error: string | null }>
  forceRefresh: (section: SectionKey) => void
}

// Runtime operational switches (mig 153 system_flags). Read via get_system_flags,
// written via admin_set_system_flags (admin-gated).
export interface SystemFlags {
  maintenance_mode: boolean
  maintenance_message: string | null
  ai_generation_enabled: boolean
  payments_enabled: boolean
  /**
   * Whether a RevenueCat SANDBOX purchase may grant anything (mig 159). OFF by
   * default: the sandbox webhook can stay enabled permanently, and test purchases
   * are acked-and-ignored until an admin opens this for a test run.
   */
  sandbox_grants_enabled: boolean
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

  pageViewsAnalytics: null,
  pageViewsLoading: false,
  pageViewsError: null,

  systemStats: null,
  systemLoading: false,
  systemError: null,
  systemFlags: null,

  auditLogs: [],
  auditTotal: 0,
  auditLoading: false,
  auditError: null,

  billingOverview: null,
  billingSubscriptions: [],
  billingPayments: [],
  billingPaymentsHasMore: false,
  billingUser: null,
  billingOverviewLoading: false,
  billingSubsLoading: false,
  billingPaymentsLoading: false,
  billingUserLoading: false,
  billingError: null,
  billingUserError: null,


  fetchOverview: async () => {
    if (get().overviewLoading) return
    if (!adminCache.shouldFetch('overview') && get().overviewStats) return
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
      })
      adminCache.markFetched('overview')
    } catch (e) {
      set({ overviewError: extractErrorMessage(e) })
    } finally {
      set({ overviewLoading: false })
    }
  },

  fetchUsers: async (page = 0, pageSize = 20, filters?: { search?: string; role?: string; official?: boolean }) => {
    if (get().usersLoading) return
    // Users page always fetches for pagination, but skip chart data if fresh
    const chartsFresh = !adminCache.shouldFetch('users') && get().userSignups.length > 0
    set({ usersLoading: true, usersError: null })
    try {
      let listQuery = supabase
        .from('profiles')
        .select('id, display_name, created_at, role, is_official, user_status')
        .order('created_at', { ascending: false })
      let countQuery = supabase.from('profiles').select('id', { count: 'exact', head: true })

      // Apply filters
      if (filters?.search) {
        listQuery = listQuery.ilike('display_name', `%${filters.search}%`)
        countQuery = countQuery.ilike('display_name', `%${filters.search}%`)
      }
      if (filters?.role) {
        listQuery = listQuery.eq('role', filters.role)
        countQuery = countQuery.eq('role', filters.role)
      }
      if (filters?.official !== undefined) {
        listQuery = listQuery.eq('is_official', filters.official)
        countQuery = countQuery.eq('is_official', filters.official)
      }

      listQuery = listQuery.range(page * pageSize, (page + 1) * pageSize - 1)

      const promises: PromiseLike<unknown>[] = [listQuery, countQuery]

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

      const profiles = (usersRes.data ?? []) as { id: string; display_name: string | null; created_at: string; role: string; is_official: boolean }[]

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
      }

      set(updates)
      if (!chartsFresh) adminCache.markFetched('users')
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
      })
      adminCache.markFetched('study')
    } catch (e) {
      set({ studyError: extractErrorMessage(e) })
    } finally {
      set({ studyLoading: false })
    }
  },

  fetchMarket: async () => {
    if (get().marketLoading) return
    if (!adminCache.shouldFetch('market') && get().marketStats) return
    set({ marketLoading: true, marketError: null })
    try {
      const { data, error } = await supabase.rpc('admin_content_stats')
      if (error) throw error
      set({
        marketStats: data as AdminContentStats | null,
      })
      adminCache.markFetched('market')
    } catch (e) {
      set({ marketError: extractErrorMessage(e) })
    } finally {
      set({ marketLoading: false })
    }
  },

  fetchContents: async () => {
    if (get().contentsLoading) return
    if (!adminCache.shouldFetch('contents') && get().contentsAnalytics) return
    set({ contentsLoading: true, contentsError: null })
    try {
      const { data, error } = await supabase.rpc('admin_content_analytics')
      if (error) throw error
      set({
        contentsAnalytics: data as AdminContentsAnalytics | null,
      })
      adminCache.markFetched('contents')
    } catch (e) {
      set({ contentsError: extractErrorMessage(e) })
    } finally {
      set({ contentsLoading: false })
    }
  },

  fetchPageViews: async () => {
    if (get().pageViewsLoading) return
    if (!adminCache.shouldFetch('pageViews') && get().pageViewsAnalytics) return
    set({ pageViewsLoading: true, pageViewsError: null })
    try {
      const { data, error } = await supabase.rpc('admin_page_views_analytics')
      if (error) throw error
      set({
        pageViewsAnalytics: data as AdminPageViewsAnalytics | null,
      })
      adminCache.markFetched('pageViews')
    } catch (e) {
      set({ pageViewsError: extractErrorMessage(e) })
    } finally {
      set({ pageViewsLoading: false })
    }
  },

  fetchSystem: async () => {
    if (get().systemLoading) return
    if (!adminCache.shouldFetch('system') && get().systemStats) return
    set({ systemLoading: true, systemError: null })
    try {
      const { data, error } = await supabase.rpc('admin_system_stats')
      if (error) throw error
      set({
        systemStats: data as AdminSystemStats | null,
      })
      adminCache.markFetched('system')
    } catch (e) {
      set({ systemError: extractErrorMessage(e) })
    } finally {
      set({ systemLoading: false })
    }
  },

  setOfficialStatus: async (userId: string, isOfficial: boolean) => {
    try {
      const { error } = await supabase.rpc('admin_set_official_status', {
        p_user_id: userId,
        p_is_official: isOfficial,
      })
      if (error) return { error: extractErrorMessage(error) }

      set({
        userList: get().userList.map((u) =>
          u.id === userId ? { ...u, is_official: isOfficial } : u,
        ),
      })

      // Log audit action
      get().logAction('set_official', 'user', userId, { is_official: isOfficial })

      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  setUserRole: async (userId: string, role: 'user' | 'admin') => {
    try {
      const { error } = await supabase.rpc('admin_set_user_role', {
        p_user_id: userId,
        p_role: role,
      })
      if (error) return { error: extractErrorMessage(error) }

      set({
        userList: get().userList.map((u) =>
          u.id === userId ? { ...u, role } : u,
        ),
      })

      get().logAction('set_role', 'user', userId, { role })

      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  setUserStatus: async (userId: string, status: UserStatus) => {
    try {
      const { error } = await supabase.rpc('admin_set_user_status', {
        p_user_id: userId,
        p_status: status,
      })
      if (error) return { error: extractErrorMessage(error) }

      set({
        userList: get().userList.map((u) =>
          u.id === userId ? { ...u, user_status: status } : u,
        ),
      })

      get().logAction('set_user_status', 'user', userId, { status })

      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  fetchAuditLogs: async (page = 0, pageSize = 50, filters?: AuditFilters) => {
    if (get().auditLoading) return
    set({ auditLoading: true, auditError: null })
    try {
      const { data, error } = await supabase.rpc('admin_get_audit_logs', {
        p_limit: pageSize,
        p_offset: page * pageSize,
        p_action: filters?.action || null,
        p_target_type: filters?.targetType || null,
        p_from_date: filters?.fromDate || null,
        p_to_date: filters?.toDate || null,
      })
      if (error) throw error

      const result = data as { data: AdminAuditLog[]; total: number } | null
      set({
        auditLogs: result?.data ?? [],
        auditTotal: result?.total ?? 0,
      })
      adminCache.markFetched('audit')
    } catch (e) {
      set({ auditError: extractErrorMessage(e) })
    } finally {
      set({ auditLoading: false })
    }
  },

  logAction: async (action: string, targetType: string, targetId?: string, details?: Record<string, unknown>) => {
    try {
      await supabase.rpc('admin_log_action', {
        p_action: action,
        p_target_type: targetType,
        p_target_id: targetId ?? null,
        p_details: details ?? {},
      })
    } catch {
      // Silent fail — audit logging should not block UI
    }
  },

  fetchBillingOverview: async () => {
    if (get().billingOverviewLoading) return
    if (!adminCache.shouldFetch('billing') && get().billingOverview) return
    set({ billingOverviewLoading: true, billingError: null })
    try {
      const { data, error } = await supabase.rpc('admin_billing_overview')
      if (error) throw error
      set({ billingOverview: data as AdminBillingOverview | null })
      adminCache.markFetched('billing')
    } catch (e) {
      set({ billingError: extractErrorMessage(e) })
    } finally {
      set({ billingOverviewLoading: false })
    }
  },

  fetchBillingSubscriptions: async (status?: string, page = 0, pageSize = 50) => {
    if (get().billingSubsLoading) return
    set({ billingSubsLoading: true, billingError: null })
    try {
      const { data, error } = await supabase.rpc('admin_list_subscriptions', {
        p_status: status ?? null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      })
      if (error) throw error
      set({ billingSubscriptions: (data as AdminSubscriptionRow[] | null) ?? [] })
    } catch (e) {
      set({ billingError: extractErrorMessage(e) })
    } finally {
      set({ billingSubsLoading: false })
    }
  },

  fetchBillingPayments: async (page = 0, pageSize = 50, append = false, platform = null) => {
    if (get().billingPaymentsLoading) return
    set({ billingPaymentsLoading: true, billingError: null })
    try {
      const { data, error } = await supabase.rpc('admin_list_payments', {
        p_limit: pageSize,
        p_offset: page * pageSize,
        p_platform: platform,
      })
      if (error) throw error
      const rows = (data as AdminPaymentRow[] | null) ?? []
      const hasMore = rows.length === pageSize
      // De-dupe on merchant_uid: offset paging over a live table can repeat a row when
      // a new payment lands between two page fetches, and React keys must stay unique.
      set(append
        ? (s) => {
            const seen = new Set(s.billingPayments.map((r) => r.merchant_uid))
            return {
              billingPayments: [...s.billingPayments, ...rows.filter((r) => !seen.has(r.merchant_uid))],
              billingPaymentsHasMore: hasMore,
            }
          }
        : { billingPayments: rows, billingPaymentsHasMore: hasMore })
    } catch (e) {
      set({ billingError: extractErrorMessage(e) })
    } finally {
      set({ billingPaymentsLoading: false })
    }
  },

  fetchUserBilling: async (userId: string) => {
    if (get().billingUserLoading) return
    set({ billingUserLoading: true, billingUserError: null })
    try {
      const { data, error } = await supabase.rpc('admin_get_user_billing', { p_user: userId })
      if (error) throw error
      set({ billingUser: (data as AdminUserBilling | null) ?? null })
    } catch (e) {
      set({ billingUserError: extractErrorMessage(e), billingUser: null })
    } finally {
      set({ billingUserLoading: false })
    }
  },

  clearUserBilling: () => set({ billingUser: null, billingUserError: null }),

  cancelSubscription: async (provider: string, providerSubscriptionId: string, immediate: boolean) => {
    try {
      const { data, error } = await supabase.rpc('admin_cancel_subscription', {
        p_provider: provider,
        p_provider_subscription_id: providerSubscriptionId,
        p_immediate: immediate,
      })
      if (error) return { error: extractErrorMessage(error) }
      const res = data as { ok?: boolean; reason?: string } | null
      if (!res?.ok) return { error: res?.reason ?? 'not_found' }
      // Entitlement moved → the overview counts are stale.
      adminCache.invalidate('billing')
      get().logAction('cancel_subscription', 'subscription', providerSubscriptionId, { provider, immediate })
      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  grantSubscription: async (userId: string, productId: string, periodEnd: string | null) => {
    try {
      const { error } = await supabase.rpc('admin_grant_subscription', {
        p_user: userId,
        p_product_id: productId,
        p_period_end: periodEnd,
      })
      if (error) return { error: extractErrorMessage(error) }
      adminCache.invalidate('billing')
      get().logAction('grant_subscription', 'subscription', userId, { product_id: productId, period_end: periodEnd })
      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  adjustWallet: async (userId: string, deltaMicro: number, reason: string) => {
    try {
      const { data, error } = await supabase.rpc('admin_adjust_wallet', {
        p_user: userId,
        p_delta_micro: deltaMicro,
        p_reason: reason,
      })
      if (error) return { error: extractErrorMessage(error) }
      const res = data as { ok?: boolean } | null
      if (!res?.ok) return { error: 'adjust_failed' }
      adminCache.invalidate('billing')
      get().logAction('adjust_wallet', 'user', userId, { delta_micro: deltaMicro, reason })
      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  refundPayment: async (kind: 'credit_pack' | 'subscription', ref: string, reason?: string) => {
    try {
      // Refund runs through the `admin-refund` Edge fn (calls the payment provider +
      // reverses our side), NOT an RPC — `functions.invoke` auto-attaches the admin JWT.
      const { data, error } = await supabase.functions.invoke('admin-refund', { body: { kind, ref, reason } })
      if (error) {
        // supabase-js FunctionsHttpError carries the raw Response in `.context`;
        // prefer our `{ error }` body over the generic message when present.
        const ctx = (error as { context?: unknown }).context
        if (ctx && typeof (ctx as Response).json === 'function') {
          try {
            const body = await (ctx as Response).json()
            if (body && typeof body.error === 'string') return { error: body.error }
          } catch { /* response wasn't JSON */ }
        }
        return { error: extractErrorMessage(error) }
      }
      // Wallet clawback / subscription revoke landed → the overview counts are stale.
      adminCache.invalidate('billing')
      const result = (data ?? undefined) as RefundResult | undefined
      // Log what ACTUALLY happened, not just that the button was pressed: on iOS the
      // call succeeds while no money moves, and the audit trail has to say which.
      get().logAction('refund_payment', kind === 'subscription' ? 'subscription' : 'payment', ref, {
        kind, reason, channel: result?.channel, providerRefunded: result?.providerRefunded ?? false,
      })
      return { error: null, result }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  checkRefundEligibility: async (kind: 'credit_pack' | 'subscription', ref: string) => {
    try {
      const { data, error } = await supabase.rpc('refund_eligibility', { p_kind: kind, p_ref: ref })
      if (error) throw error
      return { error: null, eligibility: (data ?? undefined) as RefundEligibility | undefined }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  // ── System flags / kill switches (mig 153) ──────────────────────────────
  fetchSystemFlags: async () => {
    try {
      const { data, error } = await supabase.rpc('get_system_flags')
      if (error) return
      set({ systemFlags: data as SystemFlags })
    } catch { /* leave prior value */ }
  },

  setSystemFlags: async (patch: Partial<SystemFlags>) => {
    try {
      const { data, error } = await supabase.rpc('admin_set_system_flags', {
        p_maintenance_mode: patch.maintenance_mode ?? null,
        p_maintenance_message: patch.maintenance_message ?? null,
        p_ai_generation_enabled: patch.ai_generation_enabled ?? null,
        p_payments_enabled: patch.payments_enabled ?? null,
        p_sandbox_grants_enabled: patch.sandbox_grants_enabled ?? null,
      })
      if (error) return { error: extractErrorMessage(error) }
      set({ systemFlags: data as SystemFlags })
      get().logAction('set_system_flags', 'system', 'system_flags', patch as Record<string, unknown>)
      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  setListingActive: async (listingId: string, active: boolean) => {
    try {
      const { error } = await supabase.rpc('admin_set_listing_active', {
        p_listing_id: listingId,
        p_active: active,
      })
      if (error) return { error: extractErrorMessage(error) }
      adminCache.invalidate('market')
      get().logAction(active ? 'restore_listing' : 'takedown_listing', 'listing', listingId)
      return { error: null }
    } catch (e) {
      return { error: extractErrorMessage(e) }
    }
  },

  forceRefresh: (section: SectionKey) => {
    adminCache.invalidate(section)
  },
}))
