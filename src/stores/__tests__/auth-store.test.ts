import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSupabase = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((_cb: (...args: unknown[]) => void) => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

import { useAuthStore, _resetAuthStoreInternals } from '../auth-store'

// ─── Helpers ────────────────────────────────────────────────
const resetStore = () =>
  useAuthStore.setState({ user: null, session: null, loading: true })

const fakeUser = { id: 'u1', email: 'a@b.com' } as never
const fakeSession = { user: fakeUser, access_token: 'tok' } as never

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  _resetAuthStoreInternals()
})

// ─── initialize ─────────────────────────────────────────────
describe('initialize', () => {
  it('should set user & session from existing session', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: fakeSession },
    })

    await useAuthStore.getState().initialize()

    const state = useAuthStore.getState()
    expect(state.user).toBe(fakeUser)
    expect(state.session).toBe(fakeSession)
    expect(state.loading).toBe(false)
  })

  it('should set user to null when no session exists', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    })

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().loading).toBe(false)
  })

  it('should subscribe to auth state changes', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    })

    await useAuthStore.getState().initialize()

    expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('should update state when auth state changes', async () => {
    let authCallback: (event: string, session: unknown) => void = () => {}
    mockSupabase.auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    })

    await useAuthStore.getState().initialize()

    // Simulate auth state change
    authCallback('SIGNED_IN', fakeSession)

    expect(useAuthStore.getState().user).toBe(fakeUser)
    expect(useAuthStore.getState().session).toBe(fakeSession)
  })

  it('should set loading:false when getSession throws', async () => {
    mockSupabase.auth.getSession.mockRejectedValue(new Error('Network error'))

    await useAuthStore.getState().initialize()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.session).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('should return the same promise and call getSession only once on multiple calls', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: fakeSession },
    })

    const p1 = useAuthStore.getState().initialize()
    const p2 = useAuthStore.getState().initialize()
    const p3 = useAuthStore.getState().initialize()

    expect(p1).toBe(p2)
    expect(p2).toBe(p3)

    await p1

    expect(mockSupabase.auth.getSession).toHaveBeenCalledTimes(1)
    expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
  })
})

// ─── signIn ─────────────────────────────────────────────────
describe('signIn', () => {
  it('should call signInWithPassword with email and password', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ error: null })

    await useAuthStore.getState().signIn('a@b.com', 'pass123')

    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass123',
    })
  })

  it('should return null error on success', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ error: null })

    const { error } = await useAuthStore.getState().signIn('a@b.com', 'pass123')

    expect(error).toBeNull()
  })

  it('should return Error on failure', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid credentials' },
    })

    const { error } = await useAuthStore.getState().signIn('a@b.com', 'wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Invalid credentials')
  })

  it('should return Error when signInWithPassword throws', async () => {
    mockSupabase.auth.signInWithPassword.mockRejectedValue(new Error('Network error'))

    const { error } = await useAuthStore.getState().signIn('a@b.com', 'pass123')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
  })
})

// ─── signUp ─────────────────────────────────────────────────
describe('signUp', () => {
  it('should call signUp with email, password, displayName, and redirectTo', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({ error: null })

    await useAuthStore.getState().signUp('a@b.com', 'pass123', 'TestUser')

    expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass123',
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { display_name: 'TestUser' },
      },
    })
  })

  it('should return null error on success', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({ error: null })

    const { error } = await useAuthStore.getState().signUp('a@b.com', 'pass123', 'TestUser')

    expect(error).toBeNull()
  })

  it('should return Error on failure', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({
      error: { message: 'Email taken' },
    })

    const { error } = await useAuthStore.getState().signUp('a@b.com', 'pass123', 'TestUser')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Email taken')
  })

  it('should return Error when signUp throws', async () => {
    mockSupabase.auth.signUp.mockRejectedValue(new Error('Network error'))

    const { error } = await useAuthStore.getState().signUp('a@b.com', 'pass123', 'TestUser')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
  })
})

// ─── signInWithProvider ─────────────────────────────────────
describe('signInWithProvider', () => {
  it('should call signInWithOAuth with provider and redirectTo', async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({ error: null })

    await useAuthStore.getState().signInWithProvider('google')

    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  })

  it('should work with github provider', async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({ error: null })

    await useAuthStore.getState().signInWithProvider('github')

    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  })

  it('should return null error on success', async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({ error: null })

    const { error } = await useAuthStore.getState().signInWithProvider('google')

    expect(error).toBeNull()
  })

  it('should return Error on failure', async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({
      error: { message: 'OAuth failed' },
    })

    const { error } = await useAuthStore.getState().signInWithProvider('google')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('OAuth failed')
  })

  it('should return Error when signInWithOAuth throws', async () => {
    mockSupabase.auth.signInWithOAuth.mockRejectedValue(new Error('Network error'))

    const { error } = await useAuthStore.getState().signInWithProvider('google')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
  })
})

// ─── resetPassword ──────────────────────────────────────────
describe('resetPassword', () => {
  it('should call resetPasswordForEmail with email and redirectTo', async () => {
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null })

    await useAuthStore.getState().resetPassword('a@b.com')

    expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'a@b.com',
      { redirectTo: `${window.location.origin}/auth/callback` },
    )
  })

  it('should return null error on success', async () => {
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null })

    const { error } = await useAuthStore.getState().resetPassword('a@b.com')

    expect(error).toBeNull()
  })

  it('should return Error on failure', async () => {
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Rate limit' },
    })

    const { error } = await useAuthStore.getState().resetPassword('a@b.com')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Rate limit')
  })

  it('should return Error when resetPasswordForEmail throws', async () => {
    mockSupabase.auth.resetPasswordForEmail.mockRejectedValue(new Error('Network error'))

    const { error } = await useAuthStore.getState().resetPassword('a@b.com')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
  })
})

// ─── updatePassword ─────────────────────────────────────────
describe('updatePassword', () => {
  it('should call updateUser with new password', async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({ error: null })

    await useAuthStore.getState().updatePassword('newpass')

    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'newpass',
    })
  })

  it('should return null error on success', async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({ error: null })

    const { error } = await useAuthStore.getState().updatePassword('newpass')

    expect(error).toBeNull()
  })

  it('should return Error on failure', async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({
      error: { message: 'Too weak' },
    })

    const { error } = await useAuthStore.getState().updatePassword('123')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Too weak')
  })

  it('should return Error when updateUser throws', async () => {
    mockSupabase.auth.updateUser.mockRejectedValue(new Error('Network error'))

    const { error } = await useAuthStore.getState().updatePassword('newpass')

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
  })
})

// ─── checkNicknameAvailability ──────────────────────────────
describe('checkNicknameAvailability', () => {
  it('should return available:true when nickname is available', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { available: true },
      error: null,
    })

    const result = await useAuthStore.getState().checkNicknameAvailability('NewUser')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('check_nickname_available', {
      p_nickname: 'NewUser',
    })
    expect(result).toEqual({ available: true, error: null })
  })

  it('should return available:false when nickname is taken', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { available: false },
      error: null,
    })

    const result = await useAuthStore.getState().checkNicknameAvailability('TakenUser')

    expect(result).toEqual({ available: false, error: null })
  })

  it('should return error when RPC returns an error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RPC failed' },
    })

    const result = await useAuthStore.getState().checkNicknameAvailability('Test')

    expect(result.available).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error!.message).toBe('RPC failed')
  })

  it('should return error when RPC throws', async () => {
    mockSupabase.rpc.mockRejectedValue(new Error('Network error'))

    const result = await useAuthStore.getState().checkNicknameAvailability('Test')

    expect(result.available).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error!.message).toBe('Network error')
  })

  it('should return error when data is null', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: null,
    })

    const result = await useAuthStore.getState().checkNicknameAvailability('Test')

    expect(result.available).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error!.message).toBe('No data returned')
  })

  it('should trim the nickname before sending', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { available: true },
      error: null,
    })

    await useAuthStore.getState().checkNicknameAvailability('  Spaced  ')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('check_nickname_available', {
      p_nickname: 'Spaced',
    })
  })
})

// ─── signOut ────────────────────────────────────────────────
describe('signOut', () => {
  it('should call supabase signOut and clear state', async () => {
    mockSupabase.auth.signOut.mockResolvedValue({ error: null })

    // Set some user state first
    useAuthStore.setState({ user: fakeUser, session: fakeSession })

    const { error } = await useAuthStore.getState().signOut()

    expect(mockSupabase.auth.signOut).toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().session).toBeNull()
    expect(error).toBeNull()
  })

  it('should clear state and return error when signOut returns error', async () => {
    mockSupabase.auth.signOut.mockResolvedValue({
      error: { message: 'Sign out failed' },
    })

    useAuthStore.setState({ user: fakeUser, session: fakeSession })

    const { error } = await useAuthStore.getState().signOut()

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Sign out failed')
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('should clear state and return error when signOut throws', async () => {
    mockSupabase.auth.signOut.mockRejectedValue(new Error('Network error'))

    useAuthStore.setState({ user: fakeUser, session: fakeSession })

    const { error } = await useAuthStore.getState().signOut()

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toBe('Network error')
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().session).toBeNull()
  })
})
