// Server-side AI generation client (replaces client-side BYOK `callAI`).
//
// Sends STRUCTURED params to the `ai-generate` edge function, which holds the
// provider key, meters the per-account daily free quota, and builds the prompt
// server-side. `supabase.functions.invoke` auto-attaches the user's session JWT.
import { supabase } from '../supabase'
import { groupThousands } from '../format-number'
import type { FieldHint } from './prompts'
import type { GeneratedTemplateField } from './types'

export type ServerGenerateRequest =
  | {
      kind: 'template'
      topic: string
      uiLang: string
      useCustomHtml?: boolean
      contentLang?: string
      fieldHints?: FieldHint[]
    }
  | { kind: 'deck'; topic: string; uiLang: string }
  | {
      kind: 'cards'
      topic: string
      uiLang: string
      fields: GeneratedTemplateField[]
      cardCount: number
      existingCards?: Record<string, string>[]
    }
  | {
      kind: 'image'
      images: string[] // base64 data URLs of the uploaded image(s), max 8
      uiLang: string
      fields: GeneratedTemplateField[]
      cardCount: number
    }
  | {
      kind: 'image_deck' // image(s) → a whole new deck (metadata + template + cards) in one vision call
      images: string[] // base64 data URLs of the uploaded image(s), max 8
      uiLang: string
    }
  | {
      kind: 'remediation'
      action: 'explain' | 'compare' | 'hint' | 'generate' | 'evaluate' | 'recommend' | 'diagnose'
      uiLang: string
      goalId?: string
      activityId?: string
      attemptId?: string
      cardIds?: string[]
      conceptIds?: string[]
    }

export interface ServerGenerateResult {
  content: Record<string, unknown>
  remainingFree?: number // text generation
  balance?: number       // image/remediation generation (balance after charge)
  enrichmentId?: string  // remediation preview persisted by the service role
}

// supabase-js FunctionsHttpError carries the raw Response in `.context`; read our
// `{ code }` body off it so the store can map to a localized message.
//
// Exported because every edge function this app calls answers with `{ code }` and every caller
// otherwise has to rediscover that supabase-js discards the body on a non-2xx — which is how the
// subscription portal ended up reporting eight distinct failures, two of them permanent, as one
// "please try again later".
export async function extractErrorCode(error: unknown): Promise<string> {
  // A network/transport failure surfaces as FunctionsFetchError (no Response).
  if ((error as { name?: string }).name === 'FunctionsFetchError') return 'NETWORK_ERROR'
  const ctx = (error as { context?: unknown }).context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json() as unknown
      if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
        return (body as { code: string }).code
      }
    } catch {
      /* response wasn't JSON */
    }
  }
  return 'SERVER_ERROR'
}

export async function callServerAI(req: ServerGenerateRequest): Promise<ServerGenerateResult> {
  const { data, error } = await supabase.functions.invoke('ai-generate', { body: req })
  if (error) throw new Error(await extractErrorCode(error))
  const result = data as ServerGenerateResult | null
  if (!result || typeof result !== 'object' || !result.content || typeof result.content !== 'object') {
    throw new Error('INVALID_RESPONSE')
  }
  return {
    content: result.content,
    remainingFree: typeof result.remainingFree === 'number' ? result.remainingFree : undefined,
    balance: typeof result.balance === 'number' ? result.balance : undefined,
    enrichmentId: typeof result.enrichmentId === 'string' ? result.enrichmentId : undefined,
  }
}

export interface AiGenerationQuota {
  freeLimit: number
  freeUsed: number
  remaining: number
}

// Read-only daily free-quota snapshot for the UI (cap the count selector, show
// "N free left"). Fails open to the default limit — the server is authoritative
// and will reject (429) anything genuinely over quota.
export async function getAiGenerationQuota(): Promise<AiGenerationQuota> {
  const { data, error } = await supabase.rpc('get_ai_generation_quota')
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return { freeLimit: 10, freeUsed: 0, remaining: 10 }
  return {
    freeLimit: Number(row.free_limit ?? 10),
    freeUsed: Number(row.free_used ?? 0),
    remaining: Number(row.remaining ?? 10),
  }
}

export interface AiWallet {
  balanceMicroUsd: number      // prepaid balance in micro-WON (1e-6 KRW)
  estPricePerCardMicro: number // approximate micro-USD charged per PAID card (for the UI quote)
}

// Caller's prepaid micro-WON wallet (metered billing, mig 114). The server is
// authoritative — it charges the real token cost × markup POST-generation and
// 402s at the pre-gen gate when the wallet is empty. Returns null when UNKNOWN
// due to a transient error (distinct from a known 0), so a read blip doesn't
// wrongly hard-block a paying user.
export async function getAiWallet(): Promise<AiWallet | null> {
  const { data, error } = await supabase.rpc('get_ai_wallet')
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return null
  return {
    balanceMicroUsd: Number(row.balance_micro_usd ?? 0),
    estPricePerCardMicro: Number(row.est_price_per_card_micro ?? 0),
  }
}

export interface Affordable {
  free: number
  paid: number       // ESTIMATED paid cards the balance can buy (metered → approximate)
  total: number
  walletKnown: boolean
  balanceMicroUsd?: number
}

// Cards the user can generate right now = free remaining + an ESTIMATE of what the
// balance buys (balance / est-price-per-card). Metered pricing means the real
// per-gen price varies with tokens, so `paid` is an approximate UX hint — the
// server gate is authoritative. walletKnown=false → wallet read failed; caller
// should defer to the server gate instead of hard-blocking (L1).
export async function getAffordableCards(): Promise<Affordable> {
  const [q, w] = await Promise.all([getAiGenerationQuota(), getAiWallet()])
  if (!w) return { free: q.remaining, paid: 0, total: q.remaining, walletKnown: false }
  const paid = w.estPricePerCardMicro > 0 ? Math.floor(w.balanceMicroUsd / w.estPricePerCardMicro) : 0
  return { free: q.remaining, paid, total: q.remaining + paid, walletKnown: true, balanceMicroUsd: w.balanceMicroUsd }
}

// The wallet is denominated in micro-USD (1 unit = 1e-6 USD) since mig 145 — the AI
// provider bills USD, so there's no FX hop. The `*MicroWon` field names are kept for
// churn reasons; their unit is micro-USD, which the UI renders via formatUsdMicro.
//
// Format a micro-USD amount as a `$` string.
//
// Two decimals when the amount IS a whole number of cents, four when it is not. A balance of
// $1,000,000.00 stays readable, and $12.3456 is shown in full rather than rounded to $12.35 —
// which was the complaint: the wallet said "$1,000,000.00" while a spend beside it said
// "−$0.0012", so the balance could not be seen to move by the amount that had just left it.
//
// 10,000 micro is one cent, so the test is whether anything survives that modulus.
// `sign` prefixes +/− (for ledger deltas).
export function formatUsdMicro(micro: number, opts?: { sign?: boolean }): string {
  const whole = Math.abs(Math.round(micro || 0))
  const abs = whole / 1_000_000
  const decimals = whole % 10_000 === 0 ? 2 : 4
  const s = `$${groupThousands(abs.toFixed(decimals))}`
  if (opts?.sign) return ((micro || 0) < 0 ? '−' : '+') + s
  return s
}

// Grouping lives in ../format-number so the non-AI modules (pricing.ts) can share it
// instead of re-deriving the regex. Re-exported here because every mobile/web call site
// already imports formatCount from this path.
export { formatCount } from '../format-number'

export interface WalletLedgerEntry {
  delta: number         // micro-WON; +grant/+refund, -spend
  reason: string        // 'purchase'|'spend'|'refund'|'admin_grant'|'spend_cards'|'spend_image'
  balanceAfter: number  // micro-WON balance after this entry
  createdAt: string     // ISO timestamp
}

export interface AiWalletSummary {
  balanceMicroUsd: number
  estPricePerCardMicro: number
  freeLimit: number
  freeUsedToday: number
  freeRemainingToday: number
  /**
   * Quiz runs on UNITS and a separate allowance, so it cannot be folded into the card
   * numbers above. Without these the 60-unit trial exists only inside a quote on the quiz
   * setup screen, where someone who has not opened quiz can never find out they have it.
   */
  quizUnitPriceMicro: number
  quizFreeLimit: number
  quizFreeUsedToday: number
  quizFreeRemainingToday: number
  quizTrialRemaining: number
  ledger: WalletLedgerEntry[]
}

// Full wallet snapshot for the user-facing Wallet/Usage screen: prepaid $ balance,
// today's free-tier usage, and recent ledger rows. The ledger + balance tables are
// deny-all RLS, so this SECURITY DEFINER RPC (mig 117, auth.uid()-scoped) is the
// only read path. Returns null on a transient error so the screen shows a retry
// rather than misleading zeros.
export async function getAiWalletSummary(): Promise<AiWalletSummary | null> {
  const { data, error } = await supabase.rpc('get_ai_wallet_summary')
  if (error || !data) return null
  const d = data as {
    balance_micro_usd?: number
    est_price_per_card_micro?: number
    free_limit?: number
    free_used_today?: number
    free_remaining_today?: number
    quiz_unit_price_micro?: number
    quiz_free_limit?: number
    quiz_free_used_today?: number
    quiz_free_remaining_today?: number
    quiz_trial_remaining?: number
    ledger?: Array<{ delta: number; reason: string; balance_after: number; created_at: string }>
  }
  return {
    balanceMicroUsd: Number(d.balance_micro_usd ?? 0),
    estPricePerCardMicro: Number(d.est_price_per_card_micro ?? 0),
    freeLimit: Number(d.free_limit ?? 10),
    freeUsedToday: Number(d.free_used_today ?? 0),
    freeRemainingToday: Number(d.free_remaining_today ?? 0),
    quizUnitPriceMicro: Number(d.quiz_unit_price_micro ?? 0),
    quizFreeLimit: Number(d.quiz_free_limit ?? 0),
    quizFreeUsedToday: Number(d.quiz_free_used_today ?? 0),
    quizFreeRemainingToday: Number(d.quiz_free_remaining_today ?? 0),
    quizTrialRemaining: Number(d.quiz_trial_remaining ?? 0),
    ledger: (d.ledger ?? []).map((r) => ({
      delta: Number(r.delta),
      reason: String(r.reason),
      balanceAfter: Number(r.balance_after),
      createdAt: String(r.created_at),
    })),
  }
}

// A ledger row WITH its identity id, for keyset pagination. The summary's inline
// ledger (above) omits id; this paginated path — get_ai_credit_ledger (mig 130) —
// includes it so the wallet "usage history" (사용 내역) can infinite-scroll. Pass the
// smallest id you've seen as `beforeId` to fetch the next older page; omit for page 1.
// A short page (< limit) means the end. Fails open to [] on a transient error.
export interface WalletLedgerRow extends WalletLedgerEntry {
  id: number
}

export async function getAiCreditLedger(
  beforeId?: number,
  limit = 30,
): Promise<WalletLedgerRow[]> {
  const { data, error } = await supabase.rpc('get_ai_credit_ledger', {
    p_limit: limit,
    p_before_id: beforeId ?? null,
  })
  if (error || !data) return []
  return (
    data as Array<{ id: number; delta: number; reason: string; balance_after: number; created_at: string }>
  ).map((r) => ({
    id: Number(r.id),
    delta: Number(r.delta),
    reason: String(r.reason),
    balanceAfter: Number(r.balance_after),
    createdAt: String(r.created_at),
  }))
}
