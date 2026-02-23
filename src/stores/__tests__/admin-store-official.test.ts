import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

import { useAdminStore } from '../admin-store'

// ─── Helpers ────────────────────────────────────────────────
const sampleUsers = [
  { id: 'u1', display_name: 'Alice', created_at: '2024-01-01', role: 'user', is_official: false },
  { id: 'u2', display_name: 'Bob', created_at: '2024-01-02', role: 'admin', is_official: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  useAdminStore.setState({
    userList: [...sampleUsers],
    userListTotal: 2,
    usersLoading: false,
    usersError: null,
  })
})

// ─── setOfficialStatus ──────────────────────────────────────
describe('setOfficialStatus', () => {
  it('should call supabase.rpc with correct params', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { user_id: 'u1', is_official: true }, error: null })

    await useAdminStore.getState().setOfficialStatus('u1', true)

    expect(mockSupabase.rpc).toHaveBeenCalledWith('admin_set_official_status', {
      p_user_id: 'u1',
      p_is_official: true,
    })
  })

  it('should update userList on success', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { user_id: 'u1', is_official: true }, error: null })

    const result = await useAdminStore.getState().setOfficialStatus('u1', true)

    expect(result.error).toBeNull()
    const u1 = useAdminStore.getState().userList.find((u) => u.id === 'u1')
    expect(u1?.is_official).toBe(true)
  })

  it('should NOT update userList on RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Admin access required' } })

    const result = await useAdminStore.getState().setOfficialStatus('u1', true)

    expect(result.error).toBeTruthy()
    const u1 = useAdminStore.getState().userList.find((u) => u.id === 'u1')
    expect(u1?.is_official).toBe(false) // unchanged
  })

  it('should return error when RPC throws', async () => {
    mockSupabase.rpc.mockRejectedValue(new Error('Network error'))

    const result = await useAdminStore.getState().setOfficialStatus('u1', true)

    expect(result.error).toBeTruthy()
    const u1 = useAdminStore.getState().userList.find((u) => u.id === 'u1')
    expect(u1?.is_official).toBe(false) // unchanged
  })

  it('should toggle OFF correctly', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { user_id: 'u2', is_official: false }, error: null })

    const result = await useAdminStore.getState().setOfficialStatus('u2', false)

    expect(result.error).toBeNull()
    const u2 = useAdminStore.getState().userList.find((u) => u.id === 'u2')
    expect(u2?.is_official).toBe(false)
  })
})
