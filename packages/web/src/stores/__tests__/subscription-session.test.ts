/**
 * Session validity machinery — the false "another device" kick fix.
 *
 * Core invariant: a TRANSIENT failure (network error, or token not yet refreshed
 * on background→foreground) must NEVER flip sessionValid=false. Only a definitive
 * answer does: a genuine block (e.g. session_limit_exceeded) → false; a recoverable
 * `session_expired` is handled by re-registering, not by an immediate kick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))
const mockSupabase = vi.hoisted(() => ({ rpc: (...a: unknown[]) => mockRpc(...a) }))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('../../lib/device-id', () => ({
  getDeviceId: () => 'device-1',
  getDeviceName: () => 'Test Device',
}))
vi.mock('../../lib/tier-config', () => ({ setCurrentTier: vi.fn() }))

import { useSubscriptionStore } from '../subscription-store'

function setHeartbeat(resp: unknown) {
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'session_heartbeat') return Promise.resolve(resp)
    if (fn === 'register_session') return Promise.resolve({ data: { allowed: true }, error: null })
    return Promise.resolve({ data: null, error: null })
  })
}

beforeEach(() => {
  mockRpc.mockReset()
  useSubscriptionStore.setState({ sessionValid: true, currentDeviceId: 'device-1' })
})

describe('sendHeartbeat — transient never kicks', () => {
  it('valid → ok, sessionValid stays true', async () => {
    setHeartbeat({ data: { valid: true }, error: null })
    expect(await useSubscriptionStore.getState().sendHeartbeat()).toBe('ok')
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })

  it('network/RPC error → transient, sessionValid NOT flipped (the bug fix)', async () => {
    setHeartbeat({ data: null, error: { message: 'Network request failed' } })
    expect(await useSubscriptionStore.getState().sendHeartbeat()).toBe('transient')
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })

  it('not_authenticated (token not refreshed on resume) → transient, no kick', async () => {
    setHeartbeat({ data: { valid: false, reason: 'not_authenticated' }, error: null })
    expect(await useSubscriptionStore.getState().sendHeartbeat()).toBe('transient')
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })

  it('session_expired → expired (row gone), left for re-register, not an immediate kick', async () => {
    setHeartbeat({ data: { valid: false, reason: 'session_expired' }, error: null })
    expect(await useSubscriptionStore.getState().sendHeartbeat()).toBe('expired')
    // sendHeartbeat itself does not flip — the tick re-registers first.
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })
})

describe('registerSession — only a genuine block kicks', () => {
  it('allowed → sessionValid true, registers with platform "web"', async () => {
    mockRpc.mockResolvedValue({ data: { allowed: true }, error: null })
    const r = await useSubscriptionStore.getState().registerSession()
    expect(r.allowed).toBe(true)
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
    // web store must register as the 'web' platform (app + web coexist)
    const call = mockRpc.mock.calls.find((c) => c[0] === 'register_session')
    expect((call?.[1] as { p_platform?: string })?.p_platform).toBe('web')
  })

  it('network error → sessionValid NOT flipped', async () => {
    useSubscriptionStore.setState({ sessionValid: true })
    mockRpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    await useSubscriptionStore.getState().registerSession()
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })

  it('not_authenticated → sessionValid NOT flipped', async () => {
    useSubscriptionStore.setState({ sessionValid: true })
    mockRpc.mockResolvedValue({ data: { allowed: false, reason: 'not_authenticated' }, error: null })
    await useSubscriptionStore.getState().registerSession()
    expect(useSubscriptionStore.getState().sessionValid).toBe(true)
  })

  it('genuine block (session_limit_exceeded) → sessionValid false', async () => {
    useSubscriptionStore.setState({ sessionValid: true })
    mockRpc.mockResolvedValue({ data: { allowed: false, reason: 'session_limit_exceeded' }, error: null })
    await useSubscriptionStore.getState().registerSession()
    expect(useSubscriptionStore.getState().sessionValid).toBe(false)
  })
})

describe('startHeartbeat tick — single-session policy', () => {
  it('expired → sessionValid false and does NOT auto re-register (no ping-pong)', async () => {
    vi.useFakeTimers()
    try {
      // Another device of this platform took over → row gone → session_expired.
      setHeartbeat({ data: { valid: false, reason: 'session_expired' }, error: null })
      useSubscriptionStore.setState({ sessionValid: true })
      const stop = useSubscriptionStore.getState().startHeartbeat()
      await vi.advanceTimersByTimeAsync(60 * 1000) // fire one tick
      stop()
      expect(useSubscriptionStore.getState().sessionValid).toBe(false)
      // Must NOT auto re-register — that would kick the device that took over and
      // ping-pong. The user reclaims manually via the SessionKicked screen.
      expect(mockRpc.mock.calls.some((c) => c[0] === 'register_session')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('transient (network) → sessionValid stays true, no kick', async () => {
    vi.useFakeTimers()
    try {
      setHeartbeat({ data: null, error: { message: 'net' } })
      useSubscriptionStore.setState({ sessionValid: true })
      const stop = useSubscriptionStore.getState().startHeartbeat()
      await vi.advanceTimersByTimeAsync(60 * 1000)
      stop()
      expect(useSubscriptionStore.getState().sessionValid).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
