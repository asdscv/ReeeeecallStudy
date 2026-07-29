import { getCrypto } from '../adapters/index'
import { supabase } from './supabase'
import type { SrsResult } from './srs.ts'
import type { Card, StudyMode } from '../types/database.ts'

/**
 * Minimal RPC surface required to persist a rating. Callers pass their own
 * Supabase client so the helper never depends on which client instance a
 * platform initialized.
 */
export interface AtomicRatingClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface AtomicRatingInput {
  card: Card
  deckId: string
  mode: StudyMode
  rating: string
  durationMs: number
  srsResult: SrsResult | null
  clientRatingId: string
  /** Defaults to the shared client for callers that already use it. */
  client?: AtomicRatingClient
}

export interface AtomicRatingState {
  srs_status: Card['srs_status']
  interval_days: number
  ease_factor: number
  repetitions: number
}

export type AtomicRatingResult =
  | { ok: true; logId: string; idempotent: boolean }
  | { ok: false; code: 'STALE_STATE'; currentState: AtomicRatingState }
  | { ok: false; code: 'PERSISTENCE_ERROR'; message: string }

export function createClientRatingId(): string {
  try {
    return getCrypto().randomUUID()
  } catch (error) {
    // Pure unit tests and early web bootstrap can run before platform adapters are initialized.
    const nativeCrypto = globalThis.crypto
    if (typeof nativeCrypto?.randomUUID === 'function') return nativeCrypto.randomUUID()
    throw error
  }
}

export async function persistAtomicRating(input: AtomicRatingInput): Promise<AtomicRatingResult> {
  const result = input.srsResult
  const client: AtomicRatingClient = input.client ?? (supabase as unknown as AtomicRatingClient)
  try {
    const { data, error } = await client.rpc('rate_card_and_log', {
      p_card_id: input.card.id,
      p_deck_id: input.deckId,
      p_study_mode: input.mode,
      p_rating: input.rating,
      p_prev_srs_status: input.card.srs_status,
      p_prev_interval: input.card.interval_days,
      p_prev_ease: input.card.ease_factor,
      p_prev_repetitions: input.card.repetitions,
      p_new_srs_status: result?.srs_status ?? null,
      p_new_interval: result?.interval_days ?? input.card.interval_days,
      p_new_ease: result?.ease_factor ?? input.card.ease_factor,
      p_new_repetitions: result?.repetitions ?? input.card.repetitions,
      p_new_next_review_at: result?.next_review_at ?? input.card.next_review_at,
      p_duration_ms: input.durationMs,
      p_client_rating_id: input.clientRatingId,
    })
    if (error) return { ok: false, code: 'PERSISTENCE_ERROR', message: error.message }
    const payload = data as { ok?: boolean; code?: string; current_state?: AtomicRatingState; log_id?: string; idempotent?: boolean } | null
    if (payload?.ok === false && payload.code === 'STALE_STATE' && payload.current_state) {
      return { ok: false, code: 'STALE_STATE', currentState: payload.current_state }
    }
    if (payload?.ok === true && typeof payload.log_id === 'string') {
      return { ok: true, logId: payload.log_id, idempotent: payload.idempotent === true }
    }
    return { ok: false, code: 'PERSISTENCE_ERROR', message: 'Invalid rate_card_and_log response' }
  } catch (error) {
    return { ok: false, code: 'PERSISTENCE_ERROR', message: error instanceof Error ? error.message : 'Unknown persistence error' }
  }
}
