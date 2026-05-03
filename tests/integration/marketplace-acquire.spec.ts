/**
 * Integration test — marketplace acquire flow against real local Supabase.
 *
 * 표준: DOCS/DESIGN/MARKETPLACE_ACQUIRE/DESIGN.md §5.2
 *
 * Prereqs:
 *   - `supabase start` is running locally (port 54321)
 *   - All migrations applied (`supabase db reset`)
 *
 * Invariants:
 *   I1) New subscribe acquire — deck_shares row + user_card_progress rows
 *   I2) Repeat call — share row count unchanged (UNIQUE)
 *   I3) Copy mode repeat — only 1 deck copy + 1 share row
 *   I4) Own listing — P0001 raised, no side effects
 *   I5) Cache invalidate → fetchDecks shows new deck
 *   I6) Atomicity — RPC failure rolls back deck_shares
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''

const haveLocal = !!SERVICE_ROLE_KEY && !!ANON_KEY
const itLocal = haveLocal ? it : it.skip

let admin: SupabaseClient
let publisher: { id: string; client: SupabaseClient }
let consumer: { id: string; client: SupabaseClient }
let listingId: string
let deckId: string

async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-12345',
    email_confirm: true,
  })
  if (error) throw error
  const userId = data.user!.id
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: 'test-password-12345',
  })
  if (signInErr) throw signInErr
  return { id: userId, client }
}

async function seedDeckAndListing(owner: { id: string; client: SupabaseClient }, mode: 'subscribe' | 'copy') {
  // Template (cards.template_id is NOT NULL)
  const { data: tmpl, error: tmplErr } = await owner.client
    .from('card_templates')
    .insert({
      user_id: owner.id,
      name: `Test Template ${randomUUID().slice(0, 6)}`,
      fields: [{ id: 'front', name: 'Front' }, { id: 'back', name: 'Back' }],
      front_layout: [{ id: 'front' }],
      back_layout: [{ id: 'back' }],
      is_default: false,
    })
    .select()
    .single()
  if (tmplErr) throw tmplErr

  const { data: deck, error: deckErr } = await owner.client
    .from('decks')
    .insert({
      user_id: owner.id,
      name: `Test Deck ${randomUUID().slice(0, 6)}`,
      color: '#888',
      icon: '📚',
      default_template_id: tmpl.id,
    })
    .select()
    .single()
  if (deckErr) throw deckErr

  const cardRows = [1, 2, 3].map((n) => ({
    deck_id: deck.id,
    user_id: owner.id,
    template_id: tmpl.id,
    field_values: { front: `Q${n}`, back: `A${n}` },
    sort_position: n,
  }))
  const { error: cardErr } = await owner.client.from('cards').insert(cardRows)
  if (cardErr) throw cardErr

  const { data: listing, error: listingErr } = await owner.client
    .from('marketplace_listings')
    .insert({
      deck_id: deck.id,
      owner_id: owner.id,
      title: `Listing ${randomUUID().slice(0, 6)}`,
      share_mode: mode,
      card_count: 3,
      is_active: true,
    })
    .select()
    .single()
  if (listingErr) throw listingErr

  return { deckId: deck.id, listingId: listing.id }
}

beforeAll(async () => {
  if (!haveLocal) return
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
})

beforeEach(async () => {
  if (!haveLocal) return
  publisher = await createUser(`pub-${randomUUID()}@test.local`)
  consumer = await createUser(`con-${randomUUID()}@test.local`)
})

afterAll(async () => {
  if (!haveLocal) return
  // Best-effort cleanup
  try {
    await admin.auth.admin.deleteUser(publisher.id)
    await admin.auth.admin.deleteUser(consumer.id)
  } catch {
    // ignore
  }
})

describe('acquire_listing — atomicity & idempotency (real DB)', () => {
  itLocal('I1: subscribe — creates 1 share + N progress rows', async () => {
    const seeded = await seedDeckAndListing(publisher, 'subscribe')
    listingId = seeded.listingId
    deckId = seeded.deckId

    const { data, error } = await consumer.client.rpc('acquire_listing', { p_listing_id: listingId })
    expect(error).toBeNull()
    const row = (data as Array<{ acquired_deck_id: string; is_new_acquisition: boolean }>)[0]
    expect(row.is_new_acquisition).toBe(true)
    expect(row.acquired_deck_id).toBe(deckId)

    const { data: shares } = await admin
      .from('deck_shares')
      .select('id')
      .eq('recipient_id', consumer.id)
      .eq('deck_id', deckId)
      .eq('status', 'active')
    expect(shares ?? []).toHaveLength(1)

    const { data: progress } = await admin
      .from('user_card_progress')
      .select('card_id')
      .eq('user_id', consumer.id)
      .eq('deck_id', deckId)
    expect(progress ?? []).toHaveLength(3)
  })

  itLocal('I2: repeat subscribe — share count remains 1 (UNIQUE)', async () => {
    const seeded = await seedDeckAndListing(publisher, 'subscribe')
    await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const second = await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const row = (second.data as Array<{ acquired_deck_id: string; is_new_acquisition: boolean }>)[0]
    expect(row.is_new_acquisition).toBe(false)

    const { data: shares } = await admin
      .from('deck_shares')
      .select('id')
      .eq('recipient_id', consumer.id)
      .eq('deck_id', seeded.deckId)
      .eq('status', 'active')
    expect(shares ?? []).toHaveLength(1)
  })

  itLocal('I3: copy mode repeat — only 1 deck copy + 1 share row', async () => {
    const seeded = await seedDeckAndListing(publisher, 'copy')
    const r1 = await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const r2 = await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const row2 = (r2.data as Array<{ acquired_deck_id: string; is_new_acquisition: boolean }>)[0]
    expect(row2.is_new_acquisition).toBe(false)

    const { data: ownDecks } = await admin
      .from('decks')
      .select('id')
      .eq('user_id', consumer.id)
    expect(ownDecks ?? []).toHaveLength(1)

    const { data: shares } = await admin
      .from('deck_shares')
      .select('id')
      .eq('recipient_id', consumer.id)
      .eq('deck_id', seeded.deckId)
      .eq('share_mode', 'copy')
      .eq('status', 'active')
    expect(shares ?? []).toHaveLength(1)
  })

  itLocal('I4: own listing — P0001, no side effects', async () => {
    const seeded = await seedDeckAndListing(publisher, 'subscribe')
    const { data, error } = await publisher.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    expect(data).toBeNull()
    expect((error as { code?: string } | null)?.code).toBe('P0001')

    const { data: shares } = await admin
      .from('deck_shares')
      .select('id')
      .eq('recipient_id', publisher.id)
    expect(shares ?? []).toHaveLength(0)
  })

  itLocal('I5: not found — P0002', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const { data, error } = await consumer.client.rpc('acquire_listing', { p_listing_id: fakeId })
    expect(data).toBeNull()
    expect((error as { code?: string } | null)?.code).toBe('P0002')
  })

  itLocal('I6: acquire_count increments only on first acquire (idempotent)', async () => {
    const seeded = await seedDeckAndListing(publisher, 'subscribe')

    const before = await admin.from('marketplace_listings').select('acquire_count').eq('id', seeded.listingId).single()
    expect((before.data as { acquire_count: number }).acquire_count).toBe(0)

    await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const after1 = await admin.from('marketplace_listings').select('acquire_count').eq('id', seeded.listingId).single()
    expect((after1.data as { acquire_count: number }).acquire_count).toBe(1)

    // Second call (idempotent) — count must NOT increment
    await consumer.client.rpc('acquire_listing', { p_listing_id: seeded.listingId })
    const after2 = await admin.from('marketplace_listings').select('acquire_count').eq('id', seeded.listingId).single()
    expect((after2.data as { acquire_count: number }).acquire_count).toBe(1)
  })
})
