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
  sendHeartbeat: () => Promise<boolean>
  fetchSessions: () => Promise<void>
  revokeSession: (sessionId: string) => Promise<void>
  startHeartbeat: () => () => void  // returns cleanup function
}

const HEARTBEAT_INTERVAL = 60 * 1000  // 1 minute

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
      })
      if (error) {
        return { allowed: false, reason: error.message }
      }
      const result = data as { allowed: boolean; tier?: PlanName; reason?: string }
      if (result.tier) {
        set({ tier: result.tier })
        setCurrentTier(result.tier)
      }
      set({ sessionValid: result.allowed })
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
      if (error) {
        set({ sessionValid: false })
        return false
      }
      const result = data as { valid: boolean; reason?: string }
      set({ sessionValid: result.valid })
      return result.valid
    } catch {
      return false
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
    const intervalId = setInterval(async () => {
      const valid = await get().sendHeartbeat()
      if (!valid) {
        // Session was kicked — could trigger a forced logout or warning
        set({ sessionValid: false })
      }
    }, HEARTBEAT_INTERVAL)

    // Immediate first heartbeat
    get().sendHeartbeat()

    return () => clearInterval(intervalId)
  },
}))

// Dev helper: test session kicked overlay from browser console (web only)
if (typeof window !== 'undefined' && typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
  (window as unknown as Record<string, unknown>).__simulateSessionKick = () => {
    useSubscriptionStore.setState({ sessionValid: false })
    console.log('[DEV] sessionValid → false (overlay should appear)')
  };
  (window as unknown as Record<string, unknown>).__simulateSessionRestore = () => {
    useSubscriptionStore.setState({ sessionValid: true })
    console.log('[DEV] sessionValid → true (overlay should disappear)')
  }
}
