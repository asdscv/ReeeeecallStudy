import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { MarketplaceReport, ReportCategory, ReportStatus } from '../types/database'

interface ReportState {
  // User reports
  submitting: boolean
  submitError: string | null

  // Admin reports list
  reports: MarketplaceReport[]
  reportsLoading: boolean
  reportsError: string | null
  statusFilter: ReportStatus | 'all'

  // Actions
  submitReport: (listingId: string, category: ReportCategory, description?: string) => Promise<{ id: string } | null>
  fetchReports: (status?: ReportStatus | null) => Promise<void>
  resolveReport: (reportId: string, status: 'reviewing' | 'resolved' | 'dismissed', adminNote?: string) => Promise<{ error: string | null }>
  setStatusFilter: (filter: ReportStatus | 'all') => void
}

export const useReportStore = create<ReportState>((set, get) => ({
  submitting: false,
  submitError: null,

  reports: [],
  reportsLoading: false,
  reportsError: null,
  statusFilter: 'all',

  submitReport: async (listingId, category, description) => {
    set({ submitting: true, submitError: null })
    try {
      const { data, error } = await supabase.rpc('submit_report', {
        p_listing_id: listingId,
        p_category: category,
        p_description: description ?? null,
      } as Record<string, unknown>)

      if (error) {
        // Duplicate report check (unique constraint)
        if (error.message?.includes('duplicate') || error.code === '23505') {
          set({ submitError: 'You have already reported this listing.', submitting: false })
          return null
        }
        set({ submitError: error.message, submitting: false })
        return null
      }

      set({ submitting: false })
      return { id: data as string }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to submit report'
      set({ submitError: msg, submitting: false })
      return null
    }
  },

  fetchReports: async (status) => {
    if (get().reportsLoading) return
    set({ reportsLoading: true, reportsError: null })
    try {
      const { data, error } = await supabase.rpc('admin_get_reports', {
        p_status: status ?? null,
      } as Record<string, unknown>)

      if (error) throw error

      set({
        reports: (data ?? []) as MarketplaceReport[],
        reportsLoading: false,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch reports'
      set({ reportsError: msg, reportsLoading: false })
    }
  },

  resolveReport: async (reportId, status, adminNote) => {
    try {
      const { error } = await supabase.rpc('admin_resolve_report', {
        p_report_id: reportId,
        p_status: status,
        p_admin_note: adminNote ?? null,
      } as Record<string, unknown>)

      if (error) return { error: error.message }

      // Update local state
      set({
        reports: get().reports.map((r) =>
          r.id === reportId
            ? { ...r, status, admin_note: adminNote ?? r.admin_note, resolved_at: new Date().toISOString() }
            : r,
        ),
      })

      return { error: null }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to resolve report' }
    }
  },

  setStatusFilter: (filter) => set({ statusFilter: filter }),
}))
