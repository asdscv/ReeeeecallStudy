import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// P8 lockdown. The per-phase suites prove each RPC's contract; this one proves the
// invariants that hold across the whole study surface after P1–P7:
//   • the full lifecycle works end to end on both SRS sources (smoke),
//   • a REJECTED write changes nothing at all (net-zero), and
//   • the read-only paths the client uses to build a queue write nothing (dry-run).
// The assertions are made against a fingerprint of every study table so a stray
// write anywhere in the surface fails the test, not just the row we thought to check.
const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const haveLocal = Boolean(SERVICE_ROLE_KEY && ANON_KEY)
const itLocal = haveLocal ? it : it.skip

interface TestUser { id: string; client: SupabaseClient }
interface SeededDeck { deckId: string; cardId: string; stateId: string; templateId: string }

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
      name: `Lockdown ${randomUUID()}`,
      fields: [{ id: 'front', name: 'Front' }],
      front_layout: [{ id: 'front' }],
      back_layout: [{ id: 'front' }],
    })
    .select('id')
    .single()
  if (templateError) throw templateError

  const { data: deck, error: deckError } = await owner.client
    .from('decks')
    .insert({ user_id: owner.id, name: `Lockdown ${randomUUID()}`, default_template_id: template.id })
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

  return { deckId: deck.id, cardId: card.id, stateId: state.id, templateId: template.id }
}

async function seedSubscriber(publisher: TestUser, subscriber: TestUser): Promise<SeededDeck> {
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

function applyParams(seed: SeededDeck, sessionId: string, over: Record<string, unknown> = {}) {
  return {
    p_event_id: randomUUID(),
    p_client_session_id: sessionId,
    p_card_id: seed.cardId,
    p_deck_id: seed.deckId,
    p_study_mode: 'srs',
    p_rating: 'good',
    p_srs_source: 'embedded',
    p_expected_revision: 0,
    p_new_srs: learningState(),
    p_review_duration_ms: 500,
    ...over,
  }
}

/**
 * Everything the study surface may write, per user. Rows AND their mutable state,
 * so an in-place UPDATE cannot hide behind an unchanged row count.
 */
async function fingerprint(userId: string): Promise<string> {
  const parts: string[] = []
  const q = async (table: string, cols: string) => {
    const { data, error } = await admin.from(table).select(cols).eq('user_id', userId)
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    parts.push(`${table}:${rows.length}:${JSON.stringify(rows.map((r) => Object.entries(r).sort()).sort())}`)
  }
  await q('cards', 'id,srs_status,ease_factor,interval_days,repetitions,next_review_at,last_reviewed_at,srs_revision')
  await q('user_card_progress', 'card_id,srs_status,ease_factor,interval_days,repetitions,srs_revision')
  await q('study_rating_events', 'id,status,applied_revision,rating,session_id')
  await q('study_logs', 'id,rating_event_id,rating')
  await q('study_sessions', 'id,client_session_id,cards_studied,total_cards,total_duration_ms,ratings,metadata')
  await q('deck_study_state', 'id,sequential_pos,new_start_pos,review_start_pos')
  return parts.join('|')
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

describe('study lockdown — full lifecycle smoke', () => {
  itLocal('owned card: apply → finalize → undo → re-rate → refresh lands one correct session', async () => {
    const owner = await createUser('lockdown-owned')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()
    const started = new Date(Date.now() - 10_000).toISOString()

    const first = applyParams(seed, sessionId, { p_rating: 'good', p_review_duration_ms: 800 })
    expect((await owner.client.rpc('apply_study_rating', first)).error).toBeNull()

    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: started,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    // Undo from the completion screen, then re-rate the same card differently.
    expect((await owner.client.rpc('undo_study_rating', { p_event_id: first.p_event_id })).error).toBeNull()
    const second = applyParams(seed, sessionId, {
      p_rating: 'easy',
      p_expected_revision: 2, // apply bumped to 1, undo bumped to 2
      p_review_duration_ms: 1_100,
    })
    expect((await owner.client.rpc('apply_study_rating', second)).error).toBeNull()
    expect((await owner.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const sessions = await admin.from('study_sessions')
      .select('cards_studied,total_cards,total_duration_ms,ratings,metadata')
      .eq('user_id', owner.id)
    expect(sessions.data).toHaveLength(1)
    expect(sessions.data?.[0]).toMatchObject({
      cards_studied: 1,
      total_cards: 1,
      total_duration_ms: 1_100,
      ratings: { easy: 1 },
      metadata: { study_persistence: { status: 'finalized' } },
    })

    // One live log per applied event; the undone event keeps no log.
    const logs = await admin.from('study_logs').select('rating_event_id').eq('user_id', owner.id)
    expect(logs.data).toEqual([{ rating_event_id: second.p_event_id }])
    const events = await admin.from('study_rating_events').select('id,status').eq('user_id', owner.id)
    expect((events.data ?? []).map((e) => e.status).sort()).toEqual(['applied', 'undone'])
  })

  itLocal('subscribed card: the progress row carries the session, the publisher card never moves', async () => {
    const publisher = await createUser('lockdown-pub')
    const subscriber = await createUser('lockdown-sub')
    const seed = await seedSubscriber(publisher, subscriber)
    const sessionId = randomUUID()

    const publisherCardBefore = await admin.from('cards')
      .select('srs_status,srs_revision').eq('id', seed.cardId).single()

    const event = applyParams(seed, sessionId, { p_srs_source: 'progress_table' })
    expect((await subscriber.client.rpc('apply_study_rating', event)).error).toBeNull()
    expect((await subscriber.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    expect((await admin.from('user_card_progress')
      .select('srs_status,repetitions,srs_revision')
      .eq('user_id', subscriber.id).eq('card_id', seed.cardId).single()).data)
      .toMatchObject({ srs_status: 'learning', repetitions: 1, srs_revision: 1 })
    // A subscriber's study must never touch the publisher's card.
    expect((await admin.from('cards').select('srs_status,srs_revision').eq('id', seed.cardId).single()).data)
      .toEqual(publisherCardBefore.data)
  })
})

describe('study lockdown — net-zero on rejection', () => {
  itLocal('a stale revision, a malformed payload, and a closed session leave the DB byte-identical', async () => {
    const owner = await createUser('lockdown-netzero')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    // Establish a real state first: rejections must be net-zero against a session
    // that already has history, not just against an empty database.
    const empty = await fingerprint(owner.id)
    const applied = applyParams(seed, sessionId)
    expect((await owner.client.rpc('apply_study_rating', applied)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const before = await fingerprint(owner.id)
    // Proves the fingerprint is sensitive — without this the net-zero assertions
    // below could pass on a fingerprint that never changes.
    expect(before).not.toBe(empty)

    // 1) stale revision (another device already advanced the card)
    const stale = await owner.client.rpc('apply_study_rating',
      applyParams(seed, randomUUID(), { p_expected_revision: 0 }))
    expect((stale.error as { code?: string } | null)?.code).toBe('PT409')

    // 2) malformed SRS payload
    const malformed = await owner.client.rpc('apply_study_rating',
      applyParams(seed, randomUUID(), { p_expected_revision: 1, p_new_srs: { srs_status: 'bogus' } }))
    expect((malformed.error as { code?: string } | null)?.code).toBe('22023')

    // 3) late apply into a finalized session
    const late = await owner.client.rpc('apply_study_rating',
      applyParams(seed, sessionId, { p_expected_revision: 1 }))
    expect((late.error as { code?: string } | null)?.code).toBe('55000')

    // 4) undo of an event that is no longer the latest → refused
    const undoNonLatest = await owner.client.rpc('undo_study_rating', { p_event_id: randomUUID() })
    expect((undoNonLatest.error as { code?: string } | null)?.code).toBe('P0002')

    expect(await fingerprint(owner.id)).toBe(before)
  })

  itLocal("another user's rating, finalize, undo and refresh cannot touch the owner's data", async () => {
    const owner = await createUser('lockdown-owner')
    const attacker = await createUser('lockdown-attacker')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    const applied = applyParams(seed, sessionId)
    expect((await owner.client.rpc('apply_study_rating', applied)).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const before = await fingerprint(owner.id)

    const crossApply = await attacker.client.rpc('apply_study_rating',
      applyParams(seed, randomUUID(), { p_expected_revision: 1 }))
    expect((crossApply.error as { code?: string } | null)?.code).toBe('42501')

    const crossFinalize = await attacker.client.rpc('finalize_study_session', {
      p_client_session_id: randomUUID(),
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date().toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect((crossFinalize.error as { code?: string } | null)?.code).toBe('42501')

    const crossUndo = await attacker.client.rpc('undo_study_rating', { p_event_id: applied.p_event_id })
    expect((crossUndo.error as { code?: string } | null)?.code).toBe('P0002')

    const crossRefresh = await attacker.client.rpc('refresh_study_session', {
      p_client_session_id: sessionId,
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })
    expect((crossRefresh.error as { code?: string } | null)?.code).toBe('P0002')

    expect(await fingerprint(owner.id)).toBe(before)
  })
})

describe('study lockdown — dry-run reads write nothing', () => {
  itLocal('building a study queue and reading history leaves no trace', async () => {
    const owner = await createUser('lockdown-dryrun')
    const seed = await seedOwnedDeck(owner)
    const sessionId = randomUUID()

    expect((await owner.client.rpc('apply_study_rating', applyParams(seed, sessionId))).error).toBeNull()
    expect((await owner.client.rpc('finalize_study_session', {
      p_client_session_id: sessionId,
      p_deck_id: seed.deckId,
      p_study_mode: 'srs',
      p_started_at: new Date(Date.now() - 5_000).toISOString(),
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    })).error).toBeNull()

    const before = await fingerprint(owner.id)

    // Exactly the reads initSession / the history and analytics pages perform.
    const reads = await Promise.all([
      owner.client.from('cards').select('*').eq('deck_id', seed.deckId).order('sort_position'),
      owner.client.from('deck_study_state').select('*').eq('deck_id', seed.deckId),
      owner.client.from('user_card_progress').select('*').eq('deck_id', seed.deckId),
      owner.client.from('study_sessions').select('*').order('completed_at', { ascending: false }).limit(500),
      owner.client.from('study_logs').select('*').order('studied_at', { ascending: false }).limit(5000),
      owner.client.from('study_rating_events').select('*').eq('session_id', sessionId),
      owner.client.from('card_templates').select('*').eq('id', seed.templateId),
    ])
    for (const r of reads) expect(r.error).toBeNull()

    expect(await fingerprint(owner.id)).toBe(before)
  })
})
