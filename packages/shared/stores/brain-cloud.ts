import { supabase } from '../lib/supabase'
import type { EncodedSave, RemoteBrainSave } from '../lib/brain-games'

/**
 * The account's brain save on the server (migration 288) — the only place brain progress talks to
 * Supabase. Never throws: every outcome comes back as a value, because a game must keep playing
 * whatever the network or the deploy state is.
 */

export type CloudFailure =
  | 'missing' // RPC/table not deployed yet (PGRST202 / PGRST205 / 42883 / 42P01 / 404) → device-only, quietly
  | 'offline' // no network, timeout, abort
  | 'auth' // no or expired session (42501 without the account message, PGRST301/302, 401)
  | 'account' // ran as another account (p_user_id assertion), or the account was deleted mid-flight (23503)
  | 'invalid' // 22023 — the payload was refused (size, shape, version): a client bug, do not hammer
  | 'error'

export type CloudFetch = { ok: true; save: RemoteBrainSave | null } | { ok: false; reason: CloudFailure }

export type CloudPush =
  | { ok: true; status: 'saved'; rev: number; updatedAt: string }
  | { ok: true; status: 'conflict'; save: RemoteBrainSave }
  | { ok: true; status: 'client_outdated'; rev: number }
  | { ok: false; reason: CloudFailure }

/** What the store needs from the server; tests hand in a fake (configureBrainCloud). */
export interface BrainCloud {
  fetch(): Promise<CloudFetch>
  push(input: { userId: string; baseRev: number } & EncodedSave): Promise<CloudPush>
  /** The signed-in account right now, from the client's session (null = signed out). */
  currentUserId(): Promise<string | null>
  /** Auth events with the session's account; returns the unsubscribe. */
  onAuthChange(cb: (event: string, userId: string | null) => void): () => void
}

const TIMEOUT_MS = 8_000
const MISSING_SCHEMA = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])

interface ErrorLike {
  code?: string
  message?: string
  status?: number
}

export function classifyCloudError(e: ErrorLike | null | undefined): CloudFailure {
  if (!e) return 'error'
  const code = e.code ?? ''
  const msg = e.message ?? ''
  if (MISSING_SCHEMA.has(code) || e.status === 404) return 'missing'
  if (code === '42501' && /different account/i.test(msg)) return 'account'
  if (code === '23503') return 'account'
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302' || e.status === 401) return 'auth'
  if (code === '22023') return 'invalid'
  if (!code || /fetch|network|abort|timeout/i.test(msg)) return 'offline'
  return 'error'
}

/** AbortController + setTimeout, not AbortSignal.timeout (not guaranteed on Hermes). */
async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await run(ctrl.signal)
  } finally {
    clearTimeout(t)
  }
}

function toSave(row: unknown): RemoteBrainSave | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.user_id !== 'string' || typeof r.rev !== 'number') return null
  return { userId: r.user_id, rev: r.rev, progress: r.progress, history: r.history, meta: r.meta, updatedAt: String(r.updated_at ?? '') }
}

/** get_my_brain_save: the caller's save, or null if the account never saved. */
export async function getMyBrainSave(): Promise<CloudFetch> {
  try {
    const { data, error, status } = await withTimeout((signal) => supabase.rpc('get_my_brain_save').abortSignal(signal))
    if (error) return { ok: false, reason: classifyCloudError({ code: error.code, message: error.message, status }) }
    if (data === null || data === undefined) return { ok: true, save: null }
    const save = toSave(data)
    return save ? { ok: true, save } : { ok: false, reason: 'error' }
  } catch (e) {
    return { ok: false, reason: classifyCloudError({ message: String(e) }) }
  }
}

/**
 * save_brain_progress: write the merged save iff the cloud is still at `baseRev`.
 * `userId` is the account the save was made for — the server refuses it if the session has since
 * moved to another account, so a save queued for A can never land in B's row.
 */
export async function saveBrainProgress(baseRev: number, progress: object, history: object, meta: object, userId: string): Promise<CloudPush> {
  try {
    const { data, error, status } = await withTimeout((signal) =>
      supabase
        .rpc('save_brain_progress', { p_user_id: userId, p_base_rev: baseRev, p_progress: progress, p_history: history, p_meta: meta })
        .abortSignal(signal),
    )
    if (error) return { ok: false, reason: classifyCloudError({ code: error.code, message: error.message, status }) }
    const d = (data ?? {}) as Record<string, unknown>
    if (d.status === 'saved' && typeof d.rev === 'number') return { ok: true, status: 'saved', rev: d.rev, updatedAt: String(d.updated_at ?? '') }
    if (d.status === 'conflict') {
      const save = toSave(d)
      if (save) return { ok: true, status: 'conflict', save }
    }
    if (d.status === 'client_outdated') return { ok: true, status: 'client_outdated', rev: Number(d.rev) || 0 }
    return { ok: false, reason: 'error' }
  } catch (e) {
    return { ok: false, reason: classifyCloudError({ message: String(e) }) }
  }
}

/** The adapter over the shared Supabase client. Building it touches nothing; calls do. */
export function supabaseBrainCloud(): BrainCloud {
  return {
    fetch: getMyBrainSave,
    push: ({ userId, baseRev, progress, history, meta }) => saveBrainProgress(baseRev, progress, history, meta, userId),
    async currentUserId() {
      try {
        const { data } = await supabase.auth.getSession()
        return data.session?.user.id ?? null
      } catch {
        return null
      }
    },
    onAuthChange(cb) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session?.user.id ?? null))
      return () => data.subscription.unsubscribe()
    },
  }
}
