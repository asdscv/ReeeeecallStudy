// Server-side AI generation client (replaces client-side BYOK `callAI`).
//
// Sends STRUCTURED params to the `ai-generate` edge function, which holds the
// provider key, meters the per-account daily free quota, and builds the prompt
// server-side. `supabase.functions.invoke` auto-attaches the user's session JWT.
import { supabase } from '../supabase'
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

export interface ServerGenerateResult {
  content: Record<string, unknown>
  remainingFree: number
}

// supabase-js FunctionsHttpError carries the raw Response in `.context`; read our
// `{ code }` body off it so the store can map to a localized message.
async function extractErrorCode(error: unknown): Promise<string> {
  // A network/transport failure surfaces as FunctionsFetchError (no Response).
  if ((error as { name?: string }).name === 'FunctionsFetchError') return 'NETWORK_ERROR'
  const ctx = (error as { context?: unknown }).context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json()
      if (body && typeof body.code === 'string') return body.code
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
    remainingFree: typeof result.remainingFree === 'number' ? result.remainingFree : 0,
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
  balance: number
  creditsPerCard: number
}

// Caller's prepaid credit wallet (Phase 1). Fails open to {0,1} — the server is
// authoritative (debits atomically, 402s when short).
export async function getAiWallet(): Promise<AiWallet> {
  const { data, error } = await supabase.rpc('get_ai_wallet')
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) return { balance: 0, creditsPerCard: 1 }
  return {
    balance: Number(row.balance ?? 0),
    creditsPerCard: Number(row.credits_per_card ?? 1),
  }
}

// Cards the user can generate right now = free remaining + what credits can buy.
export async function getAffordableCards(): Promise<{ free: number; paid: number; total: number }> {
  const [q, w] = await Promise.all([getAiGenerationQuota(), getAiWallet()])
  const paid = w.creditsPerCard > 0 ? Math.floor(w.balance / w.creditsPerCard) : 0
  return { free: q.remaining, paid, total: q.remaining + paid }
}
