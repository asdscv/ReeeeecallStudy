import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { getDeviceId, getDeviceName } from '../lib/device-id'
import { setCurrentTier } from '../lib/tier-config'
import type { PlanName, SubscriptionStatus } from '../lib/subscription-config'

interface SessionInfo {
  id: string
  device_id: string
  device_name: string | null
  last_seen_at: string
  created_at: string
}

interface SubscriptionState {
  // Subscription
  tier: PlanName
  status: SubscriptionStatus
  expiresAt: string | null
  // Sessions
  sessions: SessionInfo[]
  currentDeviceId: string
  sessionValid: boolean
  // Loading
  loading: boolean
  // Actions
  fetchSubscription: () => Promise<void>
  registerSession: () => Promise<{ allowed: boolean; reason?: string }>
  sendHeartbeat: () => Promise<'ok' | 'expired' | 'transient'>
  fetchSessions: () => Promise<void>
  revokeSession: (sessionId: string) => Promise<void>
  startHeartbeat: () => () => void  // returns cleanup function
}

const HEARTBEAT_INTERVAL = 60 * 1000  // 1 minute

// This (web) store registers sessions as the 'web' platform; the shared/mobile
// copy uses 'app'. register_session enforces one session per platform, so app +
// web may be logged in at the same time.
const SESSION_PLATFORM = 'web'

// Reasons that are NOT a genuine session kick: the network/auth wasn't ready
// (classic on background→foreground, before the token refreshes). These must
// never flip sessionValid=false, or the user sees a false "another device" kick.
function isTransientReason(reason?: string): boolean {
  return reason === 'not_authenticated' || reason === 'network_error'
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  tier: 'free',
  status: 'none',
  expiresAt: null,
  sessions: [],
  currentDeviceId: getDeviceId(),
  sessionValid: true,
  loading: true,

  fetchSubscription: async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_subscription')
      if (error || !data) {
        set({ tier: 'free', status: 'none', loading: false })
        setCurrentTier('free')
        return
      }
      const result = data as { tier: PlanName; status: SubscriptionStatus; expires_at?: string }
      const tier = result.tier
      set({
        tier,
        status: result.status === ('none' as SubscriptionStatus) ? 'none' : result.status,
        expiresAt: result.expires_at ?? null,
        loading: false,
      })
      setCurrentTier(tier)
    } catch {
      set({ tier: 'free', status: 'none', loading: false })
        setCurrentTier('free')
    }
  },

  registerSession: async () => {
    const deviceId = get().currentDeviceId
    const deviceName = getDeviceName()
    try {
      const { data, error } = await supabase.rpc('register_session', {
        p_device_id: deviceId,
        p_device_name: deviceName,
        p_platform: SESSION_PLATFORM,
      })
      if (error) {
        // RPC/network error → transient; do not touch sessionValid.
        return { allowed: false, reason: 'network_error' }
      }
      const result = data as { allowed: boolean; tier?: PlanName; reason?: string }
      if (result.tier) {
        set({ tier: result.tier })
        setCurrentTier(result.tier)
      }
      // Only flip sessionValid on a DEFINITIVE answer: allowed → valid; a genuine
      // block (e.g. session_limit_exceeded once limits are re-enabled) → invalid.
      // Transient reasons (token not refreshed yet) must NOT kick.
      if (result.allowed) {
        set({ sessionValid: true })
      } else if (!isTransientReason(result.reason)) {
        set({ sessionValid: false })
      }
      return { allowed: result.allowed, reason: result.reason }
    } catch {
      return { allowed: false, reason: 'network_error' }
    }
  },

  sendHeartbeat: async () => {
    const deviceId = get().currentDeviceId
    try {
      const { data, error } = await supabase.rpc('session_heartbeat', {
        p_device_id: deviceId,
      })
      // Network/RPC error → transient. A blip on background→foreground must
      // never look like a kick, so leave sessionValid untouched.
      if (error) return 'transient'
      const result = data as { valid: boolean; reason?: string }
      if (result.valid) {
        set({ sessionValid: true })
        return 'ok'
      }
      // valid=false: only a real expiry if the row is gone (session_expired).
      // not_authenticated = token not refreshed yet (transient on resume).
      if (isTransientReason(result.reason)) return 'transient'
      return 'expired'
    } catch {
      return 'transient'
    }
  },

  fetchSessions: async () => {
    try {
      const { data, error } = await supabase.rpc('get_user_sessions')
      if (error || !data) return
      set({ sessions: (data as SessionInfo[]) ?? [] })
    } catch {
      // ignore
    }
  },

  revokeSession: async (sessionId: string) => {
    try {
      await supabase
        .from('user_sessions')
        .delete()
        .eq('id', sessionId)
      // Refresh list
      await get().fetchSessions()
    } catch {
      // ignore
    }
  },

  startHeartbeat: () => {
    const tick = async () => {
      const result = await get().sendHeartbeat()
      // 'ok' → sessionValid already true. 'transient' (network/auth not ready) →
      // leave sessionValid as-is; never kick on a blip (the resume-race bug).
      // 'expired' → the session row is gone: another device of this platform took
      // over (one-session-per-platform), or the row was cleaned after 30 days.
      // Show the kick screen. Do NOT auto re-register — that would ping-pong with
      // the device that took over; the user reclaims via the SessionKicked screen
      // (or simply returning to this tab re-registers and reclaims it).
      if (result === 'expired') set({ sessionValid: false })
    }

    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL)
    return () => clearInterval(intervalId)
  },
}))

// Dev helper: test session kicked overlay from browser console
// Usage: __simulateSessionKick()
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__simulateSessionKick = () => {
    useSubscriptionStore.setState({ sessionValid: false })
    console.log('[DEV] sessionValid → false (overlay should appear)')
  };
  (window as unknown as Record<string, unknown>).__simulateSessionRestore = () => {
    useSubscriptionStore.setState({ sessionValid: true })
    console.log('[DEV] sessionValid → true (overlay should disappear)')
  }
}
