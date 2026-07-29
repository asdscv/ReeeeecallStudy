import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

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
      name: `Persistence ${randomUUID()}`,
      fields: [{ id: 'front', name: 'Front' }],
      front_layout: [{ id: 'front' }],
      back_layout: [{ id: 'front' }],
    })
    .select('id')
    .single()
  if (templateError) throw templateError

  const { data: deck, error: deckError } = await owner.client
    .from('decks')
    .insert({
      user_id: owner.id,
      name: `Persistence ${randomUUID()}`,
      default_template_id: template.id,
    })
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

async function seedSubscribedProgress(publisher: TestUser, subscriber: TestUser): Promise<SeededDeck> {
  const seed = await seedOwnedDeck(publisher)
  const { error: shareError } = await publisher.client.from('deck_shares').insert({
    deck_id: seed.deckId,
    owner_id: publisher.id,
    recipient_id: subscriber.id,
    share_mode: 'subscribe',
    status: 'active',
    accepted_at: new Date().toISOString(),
  })
  if (shareError) throw shareError
  const { error: progressError } = await subscriber.client.from('user_card_progress').insert({
    user_id: subscriber.id,
    card_id: seed.cardId,
    deck_id: seed.deckId,
  })
  if (progressError) throw progressError
  return seed
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

function applyParams(seed: SeededDeck, sessionId: string, eventId = randomUUID()) {
  return {
    p_event_id: eventId,
    p_client_session_id: sessionId,
    p_card_id: seed.cardId,
    p_deck_id: seed.deckId,
    p_study_mode: 'srs',
    p_rating: 'good',
    p_srs_source: 'embedded',
    p_expected_revision: 0,
    p_new_srs: learningState(),
    p_review_duration_ms: 750,
  }
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

describe('study persistence RPCs — atomicity, idempotency, security', () => {
  itLocal('denies anonymous apply execution', async () => {
    const { error } = await anonymous.rpc('apply_study_rating', {
      p_event_id: randomUUID(),
      p_client_session_id: randomUUID(),
      p_card_id: randomUUID(),
      p_deck_id: randomUUID(),
      p_study_mode: 'srs',
      p_rating: 'good',
      p_srs_source: 'embedded',
      p_expected_revision: 0,
      p_new_srs: learningState(),
      p_review_duration_ms: 1,
    })
    expect((error as { code?: string } | null)?.code).toBe('42501')
  })

  itLocal('atomically applies embedded SRS state, event, and one log', async () => {
    const owner = await createUser('apply-owned')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const params = applyParams(seed, randomUUID(), eventId)

    const { data, error } = await owner.client.rpc('apply_study_rating', params)
    expect(error).toBeNull()
    expect(data).toMatchObject({ event_id: eventId, status: 'applied', applied_revision: 1 })

    const card = await admin.from('cards').select('srs_status,repetitions,srs_revision').eq('id', seed.cardId).single()
    expect(card.error).toBeNull()
    expect(card.data).toMatchObject({ srs_status: 'learning', repetitions: 1, srs_revision: 1 })
    const events = await admin.from('study_rating_events').select('id,status,previous_srs,new_srs').eq('id', eventId)
    expect(events.data).toHaveLength(1)
    const logs = await admin.from('study_logs').select('rating_event_id').eq('rating_event_id', eventId)
    expect(logs.data).toEqual([{ rating_event_id: eventId }])
  })

  itLocal('enforces RPC-only writes and SELECT-own RLS on the event ledger', async () => {
    const owner = await createUser('ledger-owner')
    const attacker = await createUser('ledger-attacker')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', applyParams(seed, randomUUID(), eventId))).error)
      .toBeNull()

    const directInsert = await owner.client.from('study_rating_events').insert({
      id: randomUUID(),
      user_id: owner.id,
      session_id: randomUUID(),
      session_sequence: 1,
      card_id: seed.cardId,
      deck_id: seed.deckId,
      study_mode: 'srs',
      rating: 'good',
      srs_source: 'embedded',
    })
    expect((directInsert.error as { code?: string } | null)?.code).toBe('42501')
    expect((await owner.client.from('study_rating_events').select('id').eq('id', eventId)).data)
      .toEqual([{ id: eventId }])
    expect((await attacker.client.from('study_rating_events').select('id').eq('id', eventId)).data)
      .toEqual([])
  })

  itLocal('serializes concurrent duplicate events into one revision and one log', async () => {
    const owner = await createUser('duplicate')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const params = applyParams(seed, randomUUID(), eventId)

    const [first, second] = await Promise.all([
      owner.client.rpc('apply_study_rating', params),
      owner.client.rpc('apply_study_rating', params),
    ])
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(first.data).toEqual(second.data)

    const card = await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()
    expect(card.data).toEqual({ srs_revision: 1 })
    const logs = await admin.from('study_logs').select('id').eq('rating_event_id', eventId)
    expect(logs.data).toHaveLength(1)
  })

  itLocal('rejects stale revision with net-zero event, log, and state changes', async () => {
    const owner = await createUser('stale')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const params = { ...applyParams(seed, randomUUID(), eventId), p_expected_revision: 9 }

    const { error } = await owner.client.rpc('apply_study_rating', params)
    expect((error as { code?: string } | null)?.code).toBe('PT409')
    const card = await admin.from('cards').select('srs_status,srs_revision').eq('id', seed.cardId).single()
    expect(card.data).toEqual({ srs_status: 'new', srs_revision: 0 })
    expect((await admin.from('study_rating_events').select('id').eq('id', eventId)).data).toHaveLength(0)
    expect((await admin.from('study_logs').select('id').eq('rating_event_id', eventId)).data).toHaveLength(0)
  })

  itLocal('rejects cross-user embedded writes', async () => {
    const owner = await createUser('owner')
    const attacker = await createUser('attacker')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()

    const { error } = await attacker.client.rpc('apply_study_rating', applyParams(seed, randomUUID(), eventId))
    expect((error as { code?: string } | null)?.code).toBe('42501')
    expect((await admin.from('study_rating_events').select('id').eq('id', eventId)).data).toHaveLength(0)
  })

  itLocal('applies and undoes SRS with monotonic revision and log removal', async () => {
    const owner = await createUser('undo')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const sessionId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', applyParams(seed, sessionId, eventId))).error).toBeNull()

    const undo = await owner.client.rpc('undo_study_rating', { p_event_id: eventId })
    expect(undo.error).toBeNull()
    expect(undo.data).toMatchObject({ event_id: eventId, status: 'undone', applied_revision: 2 })
    const card = await admin.from('cards').select('srs_status,repetitions,srs_revision').eq('id', seed.cardId).single()
    expect(card.data).toEqual({ srs_status: 'new', repetitions: 0, srs_revision: 2 })
    expect((await admin.from('study_logs').select('id').eq('rating_event_id', eventId)).data).toHaveLength(0)

    const duplicate = await owner.client.rpc('undo_study_rating', { p_event_id: eventId })
    expect(duplicate.error).toBeNull()
    expect(duplicate.data).toMatchObject({ event_id: eventId, status: 'undone', applied_revision: 2 })
  })

  itLocal('records non-SRS ratings without changing card revision', async () => {
    const owner = await createUser('log-only')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const { error } = await owner.client.rpc('apply_study_rating', {
      p_event_id: eventId,
      p_client_session_id: randomUUID(),
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 50,
    })
    expect(error).toBeNull()
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 0 })
    expect((await admin.from('study_logs').select('id').eq('rating_event_id', eventId)).data).toHaveLength(1)
  })

  itLocal('finalizes once from server events and restores cursor when latest event is undone', async () => {
    const owner = await createUser('finalize')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const eventId = randomUUID()
    const apply = await owner.client.rpc('apply_study_rating', {
      p_event_id: eventId,
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 125,
    })
    expect(apply.error).toBeNull()

    const finalizeParams = {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
    }
    const first = await owner.client.rpc('finalize_study_session', finalizeParams)
    const second = await owner.client.rpc('finalize_study_session', finalizeParams)
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(first.data).toEqual(second.data)

    const sessions = await admin.from('study_sessions')
      .select('cards_studied,total_cards,total_duration_ms,ratings,metadata')
      .eq('user_id', owner.id)
      .eq('client_session_id', sessionId)
    expect(sessions.data).toHaveLength(1)
    expect(sessions.data?.[0]).toMatchObject({
      cards_studied: 1,
      total_cards: 1,
      total_duration_ms: 125,
      ratings: { next: 1 },
    })
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 1 })

    const lateEventId = randomUUID()
    const lateApply = await owner.client.rpc('apply_study_rating', {
      p_event_id: lateEventId,
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 50,
    })
    expect((lateApply.error as { code?: string } | null)?.code).toBe('55000')
    expect((await admin.from('study_rating_events').select('id').eq('id', lateEventId)).data).toHaveLength(0)
    expect((await admin.from('study_logs').select('id').eq('rating_event_id', lateEventId)).data).toHaveLength(0)

    expect((await owner.client.rpc('undo_study_rating', { p_event_id: eventId })).error).toBeNull()
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 0 })
    const reopened = await admin.from('study_sessions').select('cards_studied,metadata').eq('client_session_id', sessionId).single()
    expect(reopened.data).toMatchObject({ cards_studied: 0, metadata: { study_persistence: { status: 'reopened' } } })
  })

  itLocal('applies and undoes subscriber progress-table SRS without mutating publisher card', async () => {
    const publisher = await createUser('progress-publisher')
    const subscriber = await createUser('progress-subscriber')
    const seed = await seedSubscribedProgress(publisher, subscriber)
    const eventId = randomUUID()
    const sessionId = randomUUID()

    const apply = await subscriber.client.rpc('apply_study_rating', {
      ...applyParams(seed, sessionId, eventId),
      p_srs_source: 'progress_table',
    })
    expect(apply.error).toBeNull()
    expect(apply.data).toMatchObject({ status: 'applied', applied_revision: 1 })
    const progress = await admin.from('user_card_progress')
      .select('srs_status,repetitions,srs_revision')
      .eq('user_id', subscriber.id)
      .eq('card_id', seed.cardId)
      .single()
    expect(progress.error).toBeNull()
    expect(progress.data).toEqual({ srs_status: 'learning', repetitions: 1, srs_revision: 1 })
    expect((await admin.from('cards').select('srs_status,srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_status: 'new', srs_revision: 0 })

    const undo = await subscriber.client.rpc('undo_study_rating', { p_event_id: eventId })
    expect(undo.error).toBeNull()
    expect(undo.data).toMatchObject({ status: 'undone', applied_revision: 2 })
    expect((await admin.from('user_card_progress')
      .select('srs_status,repetitions,srs_revision')
      .eq('user_id', subscriber.id)
      .eq('card_id', seed.cardId)
      .single()).data)
      .toEqual({ srs_status: 'new', repetitions: 0, srs_revision: 2 })
  })

  itLocal('rejects reuse of an event id with a changed payload and preserves the first apply', async () => {
    const owner = await createUser('event-collision')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    const params = applyParams(seed, randomUUID(), eventId)
    expect((await owner.client.rpc('apply_study_rating', params)).error).toBeNull()

    const collision = await owner.client.rpc('apply_study_rating', {
      ...params,
      p_review_duration_ms: params.p_review_duration_ms + 1,
    })
    expect((collision.error as { code?: string } | null)?.code).toBe('23505')
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 1 })
    expect((await admin.from('study_rating_events').select('id').eq('id', eventId)).data).toHaveLength(1)
    expect((await admin.from('study_logs').select('id').eq('rating_event_id', eventId)).data).toHaveLength(1)
  })

  itLocal('rejects malformed new SRS payloads with normalized 22023 and net-zero changes', async () => {
    const owner = await createUser('invalid-srs')
    const seed = await seedOwnedDeck(owner)
    const valid = learningState()
    const missingTimestamp = { ...valid } as Record<string, unknown>
    delete missingTimestamp.next_review_at
    const invalidStates: Record<string, unknown>[] = [
      missingTimestamp,
      { ...valid, ease_factor: null },
      { ...valid, interval_days: 1.5 },
      { ...valid, next_review_at: 'not-a-timestamp' },
    ]
    const eventIds: string[] = []

    for (const invalidState of invalidStates) {
      const eventId = randomUUID()
      eventIds.push(eventId)
      const params = applyParams(seed, randomUUID(), eventId)
      const result = await owner.client.rpc('apply_study_rating', { ...params, p_new_srs: invalidState })
      expect((result.error as { code?: string } | null)?.code).toBe('22023')
    }

    expect((await admin.from('cards').select('srs_status,srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_status: 'new', srs_revision: 0 })
    expect((await admin.from('study_rating_events').select('id').in('id', eventIds)).data).toHaveLength(0)
    expect((await admin.from('study_logs').select('id').in('rating_event_id', eventIds)).data).toHaveLength(0)
  })

  itLocal('rejects undo of a non-latest event without changing either applied event', async () => {
    const owner = await createUser('non-latest-undo')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const firstId = randomUUID()
    const secondId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', applyParams(seed, sessionId, firstId))).error).toBeNull()
    const secondParams = {
      ...applyParams(seed, sessionId, secondId),
      p_expected_revision: 1,
      p_new_srs: learningState(20),
    }
    expect((await owner.client.rpc('apply_study_rating', secondParams)).error).toBeNull()

    const undo = await owner.client.rpc('undo_study_rating', { p_event_id: firstId })
    expect((undo.error as { code?: string } | null)?.code).toBe('55000')
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 2 })
    expect((await admin.from('study_rating_events').select('status,session_sequence')
      .in('id', [firstId, secondId]).order('session_sequence')).data)
      .toEqual([
        { status: 'applied', session_sequence: 1 },
        { status: 'applied', session_sequence: 2 },
      ])
    expect((await admin.from('study_logs').select('id').in('rating_event_id', [firstId, secondId])).data)
      .toHaveLength(2)
  })

  itLocal('idempotently finalizes a non-sequential session with SQL-null cursors', async () => {
    const owner = await createUser('finalize-random')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const eventId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: eventId,
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 25,
    })).error).toBeNull()
    const params = {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
    }

    const first = await owner.client.rpc('finalize_study_session', params)
    const second = await owner.client.rpc('finalize_study_session', params)
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(second.data).toEqual(first.data)
    expect(first.data).toMatchObject({ cards_studied: 1, total_duration_ms: 25, status: 'finalized' })
    expect((await admin.from('study_sessions').select('id').eq('client_session_id', sessionId)).data)
      .toHaveLength(1)
  })

  itLocal('rejects finalizing a session against an inaccessible deck', async () => {
    const owner = await createUser('finalize-owner')
    const attacker = await createUser('finalize-attacker')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    const finalize = await attacker.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_started_at: new Date().toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
    })
    expect((finalize.error as { code?: string } | null)?.code).toBe('42501')
    expect((await admin.from('study_sessions').select('id').eq('client_session_id', sessionId)).data)
      .toHaveLength(0)
  })

  itLocal('rejects stale finalize cursor with net-zero session and cursor changes', async () => {
    const owner = await createUser('stale-finalize')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const eventId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: eventId,
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 10,
    })).error).toBeNull()
    expect((await owner.client.from('deck_study_state').update({ sequential_pos: 7 }).eq('id', seed.stateId)).error)
      .toBeNull()

    const finalize = await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: { sequential_pos: 0 },
      p_cursor_after: { sequential_pos: 1 },
    })
    expect((finalize.error as { code?: string } | null)?.code).toBe('PT409')
    expect((await admin.from('deck_study_state').select('sequential_pos').eq('id', seed.stateId).single()).data)
      .toEqual({ sequential_pos: 7 })
    expect((await admin.from('study_sessions').select('id').eq('client_session_id', sessionId)).data)
      .toHaveLength(0)
    expect((await admin.from('study_rating_events').select('id').eq('id', eventId)).data)
      .toHaveLength(1)
  })

  itLocal('legacy direct SRS updates bump revision, unrelated updates do not', async () => {
    const owner = await createUser('trigger')
    const seed = await seedOwnedDeck(owner)

    expect((await owner.client.from('cards').update({ tags: ['unchanged-srs'] }).eq('id', seed.cardId)).error).toBeNull()
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 0 })
    expect((await owner.client.from('cards').update({ repetitions: 1 }).eq('id', seed.cardId)).error).toBeNull()
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 1 })
  })
})
