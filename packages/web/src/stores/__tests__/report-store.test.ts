import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

import { useReportStore } from '../report-store'

beforeEach(() => {
  vi.clearAllMocks()
  useReportStore.setState({
    reports: [],
    submitting: false,
    submitError: null,
    reportsLoading: false,
    reportsError: null,
    statusFilter: 'all',
  })
})

// ─── submitReport ──────────────────────────────────────────
describe('submitReport', () => {
  it('should submit a report via RPC and return the id', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'report-uuid-1', error: null })

    const result = await useReportStore.getState().submitReport('listing-1', 'spam', 'This is spam')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('submit_report', {
      p_listing_id: 'listing-1',
      p_category: 'spam',
      p_description: 'This is spam',
    })
    expect(result).toEqual({ id: 'report-uuid-1' })
    expect(useReportStore.getState().submitError).toBeNull()
    expect(useReportStore.getState().submitting).toBe(false)
  })

  it('should detect duplicate report (unique constraint)', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    })

    const result = await useReportStore.getState().submitReport('listing-1', 'spam')

    expect(result).toBeNull()
    expect(useReportStore.getState().submitError).toContain('already reported')
  })

  it('should handle RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Listing not found or inactive' },
    })

    const result = await useReportStore.getState().submitReport('listing-1', 'spam')

    expect(result).toBeNull()
    expect(useReportStore.getState().submitError).toBe('Listing not found or inactive')
  })

  it('should handle network error', async () => {
    mockSupabase.rpc.mockRejectedValue(new Error('Network error'))

    const result = await useReportStore.getState().submitReport('listing-1', 'spam')

    expect(result).toBeNull()
    expect(useReportStore.getState().submitError).toBe('Network error')
  })

  it('should pass null description when not provided', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'report-uuid-2', error: null })

    await useReportStore.getState().submitReport('listing-1', 'copyright')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('submit_report', {
      p_listing_id: 'listing-1',
      p_category: 'copyright',
      p_description: null,
    })
  })
})

// ─── fetchReports (admin) ──────────────────────────────────
describe('fetchReports', () => {
  it('should fetch reports via admin_get_reports RPC', async () => {
    const mockReports = [
      {
        id: 'r1',
        listing_id: 'l1',
        listing_title: 'Test Deck',
        reporter_id: 'u1',
        reporter_name: 'Alice',
        category: 'spam',
        description: null,
        status: 'pending',
        admin_note: null,
        resolved_by: null,
        resolved_at: null,
        created_at: '2024-01-01T00:00:00Z',
      },
    ]
    mockSupabase.rpc.mockResolvedValue({ data: mockReports, error: null })

    await useReportStore.getState().fetchReports(null)

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_get_reports', { p_status: null })
    expect(useReportStore.getState().reports).toEqual(mockReports)
    expect(useReportStore.getState().reportsLoading).toBe(false)
  })

  it('should pass status filter', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

    await useReportStore.getState().fetchReports('pending')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_get_reports', { p_status: 'pending' })
  })

  it('should handle fetch error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Admin access required' } })

    await useReportStore.getState().fetchReports(null)

    expect(useReportStore.getState().reportsError).toBeTruthy()
  })
})

// ─── resolveReport (admin) ─────────────────────────────────
describe('resolveReport', () => {
  beforeEach(() => {
    useReportStore.setState({
      reports: [
        {
          id: 'r1',
          listing_id: 'l1',
          listing_title: 'Test',
          reporter_id: 'u1',
          reporter_name: 'Alice',
          category: 'spam' as const,
          description: null,
          status: 'pending' as const,
          admin_note: null,
          resolved_by: null,
          resolved_at: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    })
  })

  it('should resolve a report', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    const result = await useReportStore.getState().resolveReport('r1', 'resolved', 'Addressed')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_resolve_report', {
      p_report_id: 'r1',
      p_status: 'resolved',
      p_admin_note: 'Addressed',
    })
    expect(result.error).toBeNull()
    expect(useReportStore.getState().reports[0].status).toBe('resolved')
    expect(useReportStore.getState().reports[0].admin_note).toBe('Addressed')
  })

  it('should dismiss a report', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    const result = await useReportStore.getState().resolveReport('r1', 'dismissed')

    expect(result.error).toBeNull()
    expect(useReportStore.getState().reports[0].status).toBe('dismissed')
  })

  it('should return error on failure', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Admin access required' } })

    const result = await useReportStore.getState().resolveReport('r1', 'resolved')

    expect(result.error).toBe('Admin access required')
    // Report should remain unchanged
    expect(useReportStore.getState().reports[0].status).toBe('pending')
  })

  it('should transition to reviewing status', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    await useReportStore.getState().resolveReport('r1', 'reviewing')

    expect(useReportStore.getState().reports[0].status).toBe('reviewing')
  })
})
