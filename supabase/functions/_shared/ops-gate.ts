// Shared operational gate for edge functions (mig 153 system_flags + ban + rate limit).
//
// One call at the top of a money/AI edge fn enforces, in order:
//   1. maintenance_mode      → 503 (whole app paused)
//   2. ai_generation_enabled → 503 for AI fns (instant cost/abuse kill switch)
//   3. payments_enabled      → 503 for checkout (instant server-side payment halt)
//   4. is_user_banned        → 403 (banned/suspended accounts lose the money/AI paths)
//   5. check_rate_limit      → 429 (burst guard; daily caps alone let an account fire the
//                                    whole day's budget in seconds)
//
// `sr` is a service_role Supabase client (get_system_flags is public; is_user_banned and
// check_rate_limit are service_role-callable). Returns null when allowed, else a small
// {status, code, message} the caller renders with its own json()/cors helpers. Best-effort
// but FAIL-OPEN on an unexpected RPC error (never block legit traffic on a flags read blip)
// EXCEPT it still honors an explicit disabled/banned/rate result.

// deno-lint-ignore no-explicit-any -- service-role client shape varies; runtime is fine.
type Sb = any

export interface OpsGateOpts {
  userId: string
  requireAI?: boolean
  requirePayments?: boolean
  rateKey?: string
  rateLimit?: number
  rateWindowSec?: number
}

export interface OpsBlock { status: number; code: string; message: string }

export async function opsGate(sr: Sb, o: OpsGateOpts): Promise<OpsBlock | null> {
  try {
    const { data: flags } = await sr.rpc('get_system_flags')
    if (flags?.maintenance_mode) {
      return { status: 503, code: 'MAINTENANCE', message: flags.maintenance_message || 'Service is under maintenance' }
    }
    if (o.requireAI && flags && flags.ai_generation_enabled === false) {
      return { status: 503, code: 'AI_DISABLED', message: 'AI generation is temporarily disabled' }
    }
    if (o.requirePayments && flags && flags.payments_enabled === false) {
      return { status: 503, code: 'PAYMENTS_DISABLED', message: 'Payments are temporarily disabled' }
    }
  } catch (e) {
    console.error('[ops-gate] flags read failed (fail-open):', (e as Error)?.message)
  }

  try {
    const { data: banned } = await sr.rpc('is_user_banned', { p_uid: o.userId })
    if (banned === true) return { status: 403, code: 'BANNED', message: 'This account has been suspended' }
  } catch (e) {
    console.error('[ops-gate] ban check failed (fail-open):', (e as Error)?.message)
  }

  if (o.rateKey) {
    try {
      const { data: rl } = await sr.rpc('check_rate_limit', {
        p_key: o.rateKey,
        p_limit: o.rateLimit ?? 20,
        p_window_seconds: o.rateWindowSec ?? 60,
      })
      if (rl && rl.allowed === false) {
        return { status: 429, code: 'RATE_LIMITED', message: 'Too many requests — please slow down' }
      }
    } catch (e) {
      console.error('[ops-gate] rate limit check failed (fail-open):', (e as Error)?.message)
    }
  }

  return null
}
