import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))

const mockSupabase = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((_cb: (...args: unknown[]) => void) => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    signOut: vi.fn(),
  },
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

import { useAuthStore, _resetAuthStoreInternals } from '../auth-store'

// ─── Helpers ────────────────────────────────────────────────
const resetStore = () =>
  useAuthStore.setState({ user: null, session: null, loading: true, role: null, isOfficial: false })

const fakeUser = { id: 'u1', email: 'a@b.com' } as never
const fakeSession = { user: fakeUser, access_token: 'tok' } as never

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  _resetAuthStoreInternals()

  // Wire up mockSupabase.from chain
  mockSupabase.from.mockReturnValue({ select: mockSelect })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ single: mockSingle })
})

// ─── fetchRole + isOfficial ─────────────────────────────────
describe('fetchRole sets isOfficial', () => {
  it('should set isOfficial=true when profile has is_official=true', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockSingle.mockResolvedValue({ data: { role: 'user', is_official: true }, error: null })

    await useAuthStore.getState().fetchRole()

    expect(mockSupabase.from).toHaveBeenCalledWith('profiles')
    expect(mockSelect).toHaveBeenCalledWith('role, is_official')
    expect(useAuthStore.getState().isOfficial).toBe(true)
    expect(useAuthStore.getState().role).toBe('user')
  })

  it('should set isOfficial=false when profile has is_official=false', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockSingle.mockResolvedValue({ data: { role: 'admin', is_official: false }, error: null })

    await useAuthStore.getState().fetchRole()

    expect(useAuthStore.getState().isOfficial).toBe(false)
    expect(useAuthStore.getState().role).toBe('admin')
  })

  it('should set isOfficial=false on error', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    await useAuthStore.getState().fetchRole()

    expect(useAuthStore.getState().isOfficial).toBe(false)
    expect(useAuthStore.getState().role).toBe('user')
  })

  it('should set isOfficial=false when data is null', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockSingle.mockResolvedValue({ data: null, error: null })

    await useAuthStore.getState().fetchRole()

    expect(useAuthStore.getState().isOfficial).toBe(false)
  })

  it('should set isOfficial=false when no user', async () => {
    // user is null (default)
    await useAuthStore.getState().fetchRole()

    expect(useAuthStore.getState().isOfficial).toBe(false)
    expect(useAuthStore.getState().role).toBeNull()
  })

  it('should set isOfficial=false when query throws', async () => {
    useAuthStore.setState({ user: fakeUser })
    mockSingle.mockRejectedValue(new Error('Network error'))

    await useAuthStore.getState().fetchRole()

    expect(useAuthStore.getState().isOfficial).toBe(false)
    expect(useAuthStore.getState().role).toBe('user')
  })
})

// ─── isOfficialAccount getter ───────────────────────────────
describe('isOfficialAccount', () => {
  it('should return current isOfficial value (true)', () => {
    useAuthStore.setState({ isOfficial: true })
    expect(useAuthStore.getState().isOfficialAccount()).toBe(true)
  })

  it('should return current isOfficial value (false)', () => {
    useAuthStore.setState({ isOfficial: false })
    expect(useAuthStore.getState().isOfficialAccount()).toBe(false)
  })
})

// ─── signOut resets isOfficial ──────────────────────────────
describe('signOut resets isOfficial', () => {
  it('should reset isOfficial to false on successful signOut', async () => {
    useAuthStore.setState({ user: fakeUser, session: fakeSession, isOfficial: true })
    mockSupabase.auth.signOut.mockResolvedValue({ error: null })

    await useAuthStore.getState().signOut()

    expect(useAuthStore.getState().isOfficial).toBe(false)
  })

  it('should reset isOfficial to false on signOut error', async () => {
    useAuthStore.setState({ user: fakeUser, session: fakeSession, isOfficial: true })
    mockSupabase.auth.signOut.mockRejectedValue(new Error('Network error'))

    await useAuthStore.getState().signOut()

    expect(useAuthStore.getState().isOfficial).toBe(false)
  })
})
