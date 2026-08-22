import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { getDeviceId, getDeviceName } from '../lib/device-id'
import { setCurrentTier } from '../lib/tier-config'
import { loadEntitlements } from '../lib/entitlements'
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
  revalidateSession: () => Promise<'ok' | 'expired' | 'transient'>
  fetchSessions: () => Promise<void>
  revokeSession: (sessionId: string) => Promise<void>
  startHeartbeat: () => () => void  // returns cleanup function
}

const HEARTBEAT_INTERVAL = 60 * 1000  // 1 minute

// This (shared) store powers the mobile app → sessions register as the 'app'
// platform. The web copy registers as 'web'. register_session enforces one
// session per platform, so app + web may be logged in at the same time.
const SESSION_PLATFORM = 'app'

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
  currentDeviceId: '',  // Lazy: set on first fetchSubscription/registerSession
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
      // 서버가 정한 한도를 받아 클라이언트 쿼터에 붓습니다.
      //
      // 티어만 세팅하면 한도는 `tier-config` 에 적힌 **코드의 숫자**가 그대로 쓰입니다.
      // 무료 덱 5 가 그렇게 살아 있었고, 서버는 그것을 아예 막지 않아 덱 32개를 가진 무료
      // 계정이 프로덕션에 있었습니다. 값을 바꾸는 데 앱 배포가 필요 없게 하려면 이 줄이
      // 있어야 합니다. 실패하면 기본값을 그대로 둡니다 — 총량은 서버가 다시 막습니다.
      void loadEntitlements()
    } catch {
      set({ tier: 'free', status: 'none', loading: false })
        setCurrentTier('free')
    }
  },

  registerSession: async () => {
    try {
      // Inside the try: the device adapter can throw (uninitialised adapters,
      // secure-storage failure) and that used to escape into auth-store's
      // initialize(), which then treated a valid session as no session.
      let deviceId = get().currentDeviceId
      if (!deviceId) {
        deviceId = getDeviceId()
        set({ currentDeviceId: deviceId })
      }
      const deviceName = getDeviceName()
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
    try {
      // Device resolution inside the try for the same reason as registerSession.
      let deviceId = get().currentDeviceId
      if (!deviceId) {
        deviceId = getDeviceId()
        set({ currentDeviceId: deviceId })
      }
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

  // Re-validate WITHOUT claiming. `registerSession` evicts the other device of
  // this platform, so calling it on every foreground return turns "I came back"
  // into "I steal the session" — the two devices then ping-pong and the one you
  // are actually using is the one that gets kicked (it is already 'active', so it
  // never fires a resume event to steal back, while the idle device does).
  // A heartbeat asks "is my row still there?" and takes nothing from anyone.
  revalidateSession: async () => {
    const result = await get().sendHeartbeat()
    // 'ok' → sendHeartbeat already set sessionValid true.
    // 'transient' → network/token not ready; never kick on a blip.
    // 'expired' → the row is genuinely gone: show the kick screen and let the
    //   user decide (SessionKicked '되찾기' → registerSession). Never auto-claim.
    if (result === 'expired') set({ sessionValid: false })
    return result
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
    // The tick IS a revalidation: 'ok' keeps sessionValid true, 'transient'
    // (network blip, or a token not refreshed yet) is ignored, and only a genuine
    // session_expired — the row is gone, because another device of this platform
    // took over or the 30-day cleanup removed it — shows the kick screen. It never
    // re-registers: that would evict whoever took over and ping-pong with them.
    // Reclaiming is the user's call, from the SessionKicked screen.
    const tick = () => { void get().revalidateSession() }

    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL)
    return () => clearInterval(intervalId)
  },
}))

// Dev helper: test session kicked overlay from browser console (web only)
// Guarded: only runs in browser environments with Vite dev server
try {
  if (typeof window !== 'undefined' && typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
    (window as unknown as Record<string, unknown>).__simulateSessionKick = () => {
      useSubscriptionStore.setState({ sessionValid: false })
      console.log('[DEV] sessionValid → false (overlay should appear)')
    };
    (window as unknown as Record<string, unknown>).__simulateSessionRestore = () => {
      useSubscriptionStore.setState({ sessionValid: true })
      console.log('[DEV] sessionValid → true (overlay should disappear)')
    }
  }
} catch {
  // Silently skip in environments where process is not available
}
