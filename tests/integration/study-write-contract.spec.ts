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
      name: `Contract ${randomUUID()}`,
      fields: [{ id: 'front', name: 'Front' }],
      front_layout: [{ id: 'front' }],
      back_layout: [{ id: 'front' }],
    })
    .select('id')
    .single()
  if (templateError) throw templateError

  const { data: deck, error: deckError } = await owner.client
    .from('decks')
    .insert({ user_id: owner.id, name: `Contract ${randomUUID()}`, default_template_id: template.id })
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

function learningState() {
  return {
    srs_status: 'learning',
    ease_factor: 2.4,
    interval_days: 0,
    repetitions: 1,
    next_review_at: new Date(Date.now() + 600_000).toISOString(),
    last_reviewed_at: new Date().toISOString(),
  }
}

function code(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

beforeAll(() => {
  if (!haveLocal) return
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

describe('study write contract — direct write paths are closed', () => {
  itLocal('denies direct SRS column updates on owned cards but keeps content editable', async () => {
    const owner = await createUser('contract-cards')
    const seed = await seedOwnedDeck(owner)

    const srsWrite = await owner.client.from('cards')
      .update({ srs_status: 'review', repetitions: 9 })
      .eq('id', seed.cardId)
    expect(code(srsWrite.error)).toBe('42501')

    const revisionWrite = await owner.client.from('cards')
      .update({ srs_revision: 99 })
      .eq('id', seed.cardId)
    expect(code(revisionWrite.error)).toBe('42501')

    const contentWrite = await owner.client.from('cards')
      .update({ field_values: { front: 'edited' }, tags: ['ok'] })
      .eq('id', seed.cardId)
    expect(contentWrite.error).toBeNull()

    const row = await admin.from('cards')
      .select('srs_status,repetitions,srs_revision,field_values,tags')
      .eq('id', seed.cardId)
      .single()
    expect(row.data).toMatchObject({
      srs_status: 'new',
      repetitions: 0,
      srs_revision: 0,
      field_values: { front: 'edited' },
      tags: ['ok'],
    })
  })

  itLocal('denies direct progress-table SRS updates for subscribers', async () => {
    const publisher = await createUser('contract-pub')
    const subscriber = await createUser('contract-sub')
    const seed = await seedSubscribedProgress(publisher, subscriber)

    const write = await subscriber.client.from('user_card_progress')
      .update({ srs_status: 'review', repetitions: 5 })
      .eq('user_id', subscriber.id)
      .eq('card_id', seed.cardId)
    expect(code(write.error)).toBe('42501')

    expect((await admin.from('user_card_progress')
      .select('srs_status,repetitions,srs_revision')
      .eq('user_id', subscriber.id)
      .eq('card_id', seed.cardId)
      .single()).data)
      .toEqual({ srs_status: 'new', repetitions: 0, srs_revision: 0 })
  })

  itLocal('makes study_logs and study_sessions server-written only', async () => {
    const owner = await createUser('contract-history')
    const seed = await seedOwnedDeck(owner)

    const logInsert = await owner.client.from('study_logs').insert({
      user_id: owner.id,
      card_id: seed.cardId,
      deck_id: seed.deckId,
      study_mode: 'sequential',
      rating: 'next',
    })
    expect(code(logInsert.error)).toBe('42501')

    const sessionInsert = await owner.client.from('study_sessions').insert({
      user_id: owner.id,
      deck_id: seed.deckId,
      study_mode: 'random',
      cards_studied: 99,
      total_cards: 99,
      total_duration_ms: 1,
      ratings: { next: 99 },
      started_at: new Date().toISOString(),
    })
    expect(code(sessionInsert.error)).toBe('42501')

    // Reads must keep working for the analytics pages.
    expect((await owner.client.from('study_logs').select('id').limit(1)).error).toBeNull()
    expect((await owner.client.from('study_sessions').select('id').limit(1)).error).toBeNull()
    expect((await admin.from('study_sessions').select('id').eq('deck_id', seed.deckId)).data).toHaveLength(0)
  })

  itLocal('removes the superseded insert_study_log RPC', async () => {
    const owner = await createUser('contract-legacy')
    const seed = await seedOwnedDeck(owner)

    const { error } = await owner.client.rpc('insert_study_log', {
      p_user_id: owner.id,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_prev_interval: 0,
      p_new_interval: 0,
      p_prev_ease: 2.5,
      p_new_ease: 2.5,
      p_review_duration_ms: 10,
      p_prev_srs_status: 'new',
    })
    expect(code(error)).toBe('PGRST202')
  })

  itLocal('locks cursor columns while leaving batch sizes client-tunable', async () => {
    const owner = await createUser('contract-cursor')
    const seed = await seedOwnedDeck(owner)

    const cursorWrite = await owner.client.from('deck_study_state')
      .update({ sequential_pos: 42 })
      .eq('id', seed.stateId)
    expect(code(cursorWrite.error)).toBe('42501')

    const reviewWrite = await owner.client.from('deck_study_state')
      .update({ new_start_pos: 7, review_start_pos: 7 })
      .eq('id', seed.stateId)
    expect(code(reviewWrite.error)).toBe('42501')

    const batchWrite = await owner.client.from('deck_study_state')
      .update({ new_batch_size: 30, review_batch_size: 60 })
      .eq('id', seed.stateId)
    expect(batchWrite.error).toBeNull()

    expect((await admin.from('deck_study_state')
      .select('sequential_pos,new_start_pos,review_start_pos,new_batch_size,review_batch_size')
      .eq('id', seed.stateId)
      .single()).data)
      .toEqual({
        sequential_pos: 0,
        new_start_pos: 0,
        review_start_pos: 0,
        new_batch_size: 30,
        review_batch_size: 60,
      })
  })

  itLocal('finalizes with client metadata merged under server study_persistence', async () => {
    const owner = await createUser('contract-metadata')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: randomUUID(),
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'cramming',
      p_rating: 'got_it',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 40,
    })).error).toBeNull()

    const params = {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'cramming',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: { cramming: { rounds: 2, mastery_percentage: 100 } },
    }
    const first = await owner.client.rpc('finalize_study_session', params)
    const second = await owner.client.rpc('finalize_study_session', params)
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(second.data).toEqual(first.data)

    const sessions = await admin.from('study_sessions')
      .select('cards_studied,metadata')
      .eq('client_session_id', sessionId)
    expect(sessions.data).toHaveLength(1)
    expect(sessions.data?.[0]).toMatchObject({
      cards_studied: 1,
      metadata: {
        cramming: { rounds: 2, mastery_percentage: 100 },
        study_persistence: { status: 'finalized' },
      },
    })
  })

  itLocal('refuses client metadata that tries to forge study_persistence', async () => {
    const owner = await createUser('contract-forge')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: randomUUID(),
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 5,
    })).error).toBeNull()

    const { error } = await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: { study_persistence: { status: 'forged', cursor_after: { sequential_pos: 99 } } },
    })
    expect(error).toBeNull()

    const saved = await admin.from('study_sessions').select('metadata').eq('client_session_id', sessionId).single()
    expect(saved.data).toMatchObject({
      metadata: { study_persistence: { status: 'finalized', cursor_after: null } },
    })
  })

  itLocal('keeps the 6-argument finalize overload working for rolling clients', async () => {
    const owner = await createUser('contract-overload')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: randomUUID(),
      p_client_session_id: sessionId,
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
      p_review_duration_ms: 15,
    })).error).toBeNull()

    const { error, data } = await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'random',
      p_started_at: new Date(Date.now() - 1000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ cards_studied: 1, status: 'finalized' })
  })

  itLocal('resets owned SRS through reset_card_srs with a forward-moving revision', async () => {
    const owner = await createUser('contract-reset')
    const seed = await seedOwnedDeck(owner)
    const eventId = randomUUID()
    expect((await owner.client.rpc('apply_study_rating', {
      p_event_id: eventId,
      p_client_session_id: randomUUID(),
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_rating: 'good',
      p_srs_source: 'embedded',
      p_expected_revision: 0,
      p_new_srs: learningState(),
      p_review_duration_ms: 100,
    })).error).toBeNull()

    const reset = await owner.client.rpc('reset_card_srs', { p_card_id: seed.cardId })
    expect(reset.error).toBeNull()
    expect(reset.data).toMatchObject({ srs_source: 'embedded', applied_revision: 2 })
    expect((await admin.from('cards')
      .select('srs_status,ease_factor,interval_days,repetitions,next_review_at,srs_revision')
      .eq('id', seed.cardId)
      .single()).data)
      .toEqual({
        srs_status: 'new',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        next_review_at: null,
        srs_revision: 2,
      })

    // A reset is a new state transition, not an undo: compensating the old event must
    // fail closed rather than silently reviving pre-reset scheduling.
    const undo = await owner.client.rpc('undo_study_rating', { p_event_id: eventId })
    expect(code(undo.error)).toBe('PT409')
  })

  itLocal('resets only the subscriber progress row, never the publisher card', async () => {
    const publisher = await createUser('contract-reset-pub')
    const subscriber = await createUser('contract-reset-sub')
    const seed = await seedSubscribedProgress(publisher, subscriber)
    expect((await subscriber.client.rpc('apply_study_rating', {
      p_event_id: randomUUID(),
      p_client_session_id: randomUUID(),
      p_card_id: seed.cardId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_rating: 'good',
      p_srs_source: 'progress_table',
      p_expected_revision: 0,
      p_new_srs: learningState(),
      p_review_duration_ms: 100,
    })).error).toBeNull()

    const reset = await subscriber.client.rpc('reset_card_srs', { p_card_id: seed.cardId })
    expect(reset.error).toBeNull()
    expect(reset.data).toMatchObject({ srs_source: 'progress_table', applied_revision: 2 })
    expect((await admin.from('user_card_progress')
      .select('srs_status,repetitions,srs_revision')
      .eq('user_id', subscriber.id)
      .eq('card_id', seed.cardId)
      .single()).data)
      .toEqual({ srs_status: 'new', repetitions: 0, srs_revision: 2 })
    expect((await admin.from('cards').select('srs_status,srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_status: 'new', srs_revision: 0 })
  })

  itLocal('denies reset_card_srs for an inaccessible card', async () => {
    const owner = await createUser('contract-reset-owner')
    const attacker = await createUser('contract-reset-attacker')
    const seed = await seedOwnedDeck(owner)

    const { error } = await attacker.client.rpc('reset_card_srs', { p_card_id: seed.cardId })
    expect(code(error)).toBe('42501')
    expect((await admin.from('cards').select('srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual({ srs_revision: 0 })
  })
})
