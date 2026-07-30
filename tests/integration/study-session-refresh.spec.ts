import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// P6: refresh_study_session — the only way to correct a session that
// undo_study_rating reopened. finalize is idempotent per (user, session id), so a
// second finalize returns the FIRST result and would leave both the aggregate and
// the cursor describing the attempt the user discarded.
const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const haveLocal = Boolean(SERVICE_ROLE_KEY && ANON_KEY)
const itLocal = haveLocal ? it : it.skip

interface TestUser { id: string; client: SupabaseClient }
interface SeededDeck { deckId: string; cardId: string; stateId: string }

let admin: SupabaseClient
let anonymous: SupabaseClient
const usersToDelete: string[] = []

async function createUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@test.local`
  const password = 'test-password-12345'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('user creation failed')
  usersToDelete.push(data.user.id)
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, client }
}

async function seedOwnedDeck(owner: TestUser): Promise<SeededDeck> {
  const { data: template, error: templateError } = await owner.client
    .from('card_templates')
    .insert({
      user_id: owner.id,
      name: `Refresh ${randomUUID()}`,
      fields: [{ id: 'front', name: 'Front' }],
      front_layout: [{ id: 'front' }],
      back_layout: [{ id: 'front' }],
    })
    .select('id')
    .single()
  if (templateError) throw templateError

  const { data: deck, error: deckError } = await owner.client
    .from('decks')
    .insert({ user_id: owner.id, name: `Refresh ${randomUUID()}`, default_template_id: template.id })
    .select('id')
    .single()
  if (deckError) throw deckError

  const { data: card, error: cardError } = await owner.client
    .from('cards')
    .insert({
      user_id: owner.id,
      deck_id: deck.id,
      template_id: template.id,
      field_values: { front: 'question' },
      sort_position: 0,
    })
    .select('id')
    .single()
  if (cardError) throw cardError

  const { data: state, error: stateError } = await owner.client
    .from('deck_study_state')
    .insert({ user_id: owner.id, deck_id: deck.id })
    .select('id')
    .single()
  if (stateError) throw stateError

  return { deckId: deck.id, cardId: card.id, stateId: state.id }
}

function learningState(minutes = 10) {
  return {
    srs_status: 'learning',
    ease_factor: 2.4,
    interval_days: 0,
    repetitions: 1,
    next_review_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    last_reviewed_at: new Date().toISOString(),
  }
}

/** SRS-mode apply: the RPC requires an owned card, the expected revision, and the new state. */
function srsApply(
  seed: SeededDeck,
  sessionId: string,
  rating: string,
  expectedRevision: number,
  durationMs: number,
): Record<string, unknown> {
  return {
    p_event_id: randomUUID(),
    p_client_session_id: sessionId,
    p_card_id: seed.cardId,
    p_deck_id: seed.deckId,
    p_study_mode: 'srs',
    p_rating: rating,
    p_srs_source: 'embedded',
    p_expected_revision: expectedRevision,
    p_new_srs: learningState(),
    p_review_duration_ms: durationMs,
  }
}

/** Log-only apply for the modes that do not touch SRS state. */
function logApply(
  seed: SeededDeck,
  sessionId: string,
  mode: string,
  rating: string,
  durationMs = 500,
): Record<string, unknown> {
  return {
    p_event_id: randomUUID(),
    p_client_session_id: sessionId,
    p_card_id: seed.cardId,
    p_deck_id: seed.deckId,
    p_study_mode: mode,
    p_rating: rating,
    p_srs_source: 'none',
    p_expected_revision: null,
    p_new_srs: null,
    p_review_duration_ms: durationMs,
  }
}

async function sessionRow(sessionId: string) {
  const { data, error } = await admin
    .from('study_sessions')
    .select('id,cards_studied,total_cards,total_duration_ms,ratings,metadata')
    .eq('client_session_id', sessionId)
  if (error) throw error
  return data ?? []
}

beforeAll(() => {
  if (!haveLocal) return
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  anonymous = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
})

afterEach(async () => {
  if (!haveLocal) return
  while (usersToDelete.length > 0) {
    const userId = usersToDelete.pop()!
    await admin.auth.admin.deleteUser(userId)
  }
})

describe('refresh_study_session — correcting a session reopened by undo', () => {
  itLocal('re-finalizes the corrected aggregate into the SAME session row', async () => {
    const owner = await createUser('refresh-srs')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const started = new Date(Date.now() - 5_000).toISOString()

    const first = srsApply(seed, sessionId, 'good', 0, 900)
    expect((await owner.client.rpc('apply_study_rating', first)).error).toBeNull()

    const finalize = await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: started,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect(finalize.error).toBeNull()
    expect(await sessionRow(sessionId)).toMatchObject([{ cards_studied: 1, ratings: { good: 1 } }])

    // Undo from the completion screen, then re-rate the card differently.
    expect((await owner.client.rpc('undo_study_rating', { p_event_id: first.p_event_id })).error).toBeNull()
    expect((await sessionRow(sessionId))[0]).toMatchObject({
      cards_studied: 0,
      metadata: { study_persistence: { status: 'reopened' } },
    })

    // apply bumped the revision to 1 and undo bumped it again to 2.
    const second = srsApply(seed, sessionId, 'easy', 2, 1_200)
    expect((await owner.client.rpc('apply_study_rating', second)).error).toBeNull()

    // A second finalize can only echo the first result — proof that refresh is required.
    // Identical payload: the retry path, which is exactly what a re-completion sends.
    const refinalize = await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: started,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect(refinalize.error).toBeNull()
    expect((await sessionRow(sessionId))[0]).toMatchObject({ cards_studied: 0, ratings: {} })

    const refresh = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect(refresh.error).toBeNull()
    expect(refresh.data).toMatchObject({
      cards_studied: 1,
      total_cards: 1,
      total_duration_ms: 1_200,
      ratings: { easy: 1 },
      status: 'finalized',
    })

    const rows = await sessionRow(sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      cards_studied: 1,
      total_cards: 1,
      total_duration_ms: 1_200,
      ratings: { easy: 1 },
      metadata: { study_persistence: { status: 'finalized' } },
    })
  })

  itLocal('discards the row when every rating of the session was undone', async () => {
    const owner = await createUser('refresh-discard')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const started = new Date(Date.now() - 5_000).toISOString()

    const only = srsApply(seed, sessionId, 'good', 0, 700)
    expect((await owner.client.rpc('apply_study_rating', only)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: started,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()
    expect((await owner.client.rpc('undo_study_rating', { p_event_id: only.p_event_id })).error).toBeNull()

    const refresh = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect(refresh.error).toBeNull()
    expect(refresh.data).toMatchObject({ status: 'discarded', cards_studied: 0 })
    // A 0-card, 0-minute session in history and analytics is worse than no session.
    expect(await sessionRow(sessionId)).toHaveLength(0)
    // The undone event stays in the ledger — the audit trail is not rewritten.
    expect((await admin.from('study_rating_events').select('status').eq('id', only.p_event_id)).data)
      .toEqual([{ status: 'undone' }])

    // With the row gone, the same session id can be finalized fresh after a re-rating.
    const again = srsApply(seed, sessionId, 'easy', 2, 400)
    expect((await owner.client.rpc('apply_study_rating', again)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: started,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()
    const rows = await sessionRow(sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cards_studied: 1, total_duration_ms: 400, ratings: { easy: 1 } })
  })

  itLocal('re-advances the sequential cursor that undo rewound', async () => {
    const owner = await createUser('refresh-seq')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const started = new Date(Date.now() - 5_000).toISOString()

    const first = logApply(seed, sessionId, 'sequential', 'next')
    expect((await owner.client.rpc('apply_study_rating', first)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_started_at: started,
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
      p_metadata: null,
    })).error).toBeNull()
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 1 })

    // undo rolls the cursor back to cursor_before — without refresh moving it again,
    // the corrected session would silently lose the user's progress.
    expect((await owner.client.rpc('undo_study_rating', { p_event_id: first.p_event_id })).error).toBeNull()
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 0 })

    const second = logApply(seed, sessionId, 'sequential', 'next')
    expect((await owner.client.rpc('apply_study_rating', second)).error).toBeNull()

    const refresh = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
      p_metadata: null,
    })
    expect(refresh.error).toBeNull()
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 1 })
    expect((await sessionRow(sessionId))[0]).toMatchObject({
      cards_studied: 1,
      metadata: {
        study_persistence: {
          status: 'finalized',
          cursor_before: { sequential_pos: 0 },
          cursor_after: { sequential_pos: 1 },
        },
      },
    })
  })

  itLocal('rejects a stale sequential cursor with net-zero cursor and session changes', async () => {
    const owner = await createUser('refresh-stale')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    const event = logApply(seed, sessionId, 'sequential', 'next')
    expect((await owner.client.rpc('apply_study_rating', event)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
      p_metadata: null,
    })).error).toBeNull()

    // The cursor is at 1, so a refresh claiming it is still 0 describes a world that
    // no longer exists (another session moved it).
    const stale = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 5 },
      p_metadata: null,
    })
    expect((stale.error as { code?: string } | null)?.code).toBe('PT409')
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 1 })
    expect((await sessionRow(sessionId))[0]).toMatchObject({
      metadata: { study_persistence: { cursor_after: { sequential_pos: 1 } } },
    })
  })

  itLocal('rejects a cursor payload on a non-sequential session', async () => {
    const owner = await createUser('refresh-nocursor')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    expect((await owner.client.rpc('apply_study_rating', srsApply(seed, sessionId, 'good', 0, 500))).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const { error } = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
      p_metadata: null,
    })
    expect((error as { code?: string } | null)?.code).toBe('22023')
  })

  itLocal('merges client analytics under the server-owned persistence key', async () => {
    const owner = await createUser('refresh-meta')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    expect((await owner.client.rpc('apply_study_rating',
      logApply(seed, sessionId, 'cramming', 'got_it'))).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'cramming',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: { cramming: { rounds: 1 } },
    })).error).toBeNull()

    const refresh = await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      // A client must not be able to forge the lifecycle marker.
      p_metadata: { cramming: { rounds: 2 }, study_persistence: { status: 'forged' } },
    })
    expect(refresh.error).toBeNull()
    expect((await sessionRow(sessionId))[0]).toMatchObject({
      metadata: { cramming: { rounds: 2 }, study_persistence: { status: 'finalized' } },
    })
  })

  itLocal('keeps existing analytics when the refresh carries no metadata', async () => {
    const owner = await createUser('refresh-keepmeta')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    expect((await owner.client.rpc('apply_study_rating',
      logApply(seed, sessionId, 'cramming', 'got_it'))).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'cramming',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: { cramming: { rounds: 3 } },
    })).error).toBeNull()

    expect((await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()
    expect((await sessionRow(sessionId))[0]).toMatchObject({
      metadata: { cramming: { rounds: 3 }, study_persistence: { status: 'finalized' } },
    })
  })

  itLocal("refuses to refresh another user's session", async () => {
    const owner = await createUser('refresh-owner')
    const attacker = await createUser('refresh-attacker')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    expect((await owner.client.rpc('apply_study_rating', srsApply(seed, sessionId, 'good', 0, 500))).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const { error } = await attacker.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    // Same answer as a missing session: SECURITY DEFINER must not leak existence.
    expect((error as { code?: string } | null)?.code).toBe('P0002')
    expect((await sessionRow(sessionId))[0]).toMatchObject({ cards_studied: 1 })
  })

  itLocal('denies anonymous refresh execution', async () => {
    const { error } = await anonymous.rpc('refresh_study_session', {
      p_client_session_id: randomUUID(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect((error as { code?: string } | null)?.code).toBe('42501')
  })
})
