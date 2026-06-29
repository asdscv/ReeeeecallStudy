/**
 * Template-store: findOrCreatePresetTemplate (Quick Create's core glue)
 *
 * This is the function that lets the simple flow reuse one card_template per
 * field-shape instead of spawning duplicates, and that survives the concurrent
 * UNIQUE(user_id,name) race by re-reading. It had zero unit coverage before —
 * a regression here (e.g. dropping the race re-read) would surface as a "create
 * failed" to users with no test catching it.
 *
 * web re-exports the shared store, so importing '../template-store' exercises
 * the shared implementation. Mocks mirror deck-store-subscriptions.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
}))

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: () => mockGetUser() },
  rpc: vi.fn(),
  from: (...args: unknown[]) => mockFrom(...args),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabase: () => mockSupabase,
  initSupabase: vi.fn(),
}))
vi.mock('../../lib/rate-limit-instance', () => ({
  guard: { check: () => ({ allowed: true }), recordSuccess: vi.fn() },
}))
vi.mock('@reeeeecall/shared/lib/rate-limit-instance', () => ({
  guard: { check: () => ({ allowed: true }), recordSuccess: vi.fn() },
}))

import { useTemplateStore } from '../template-store'
import { QUICK_PRESETS } from '@reeeeecall/shared/lib/default-templates'

// A thenable Supabase query-builder stub: every chained method returns itself,
// awaiting resolves the provided value, and `.insert` is counted so a test can
// assert whether a create actually happened.
let insertCalls = 0
function chain(value: { data: unknown; error: unknown }) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(value)
      if (prop === 'insert') return () => { insertCalls++; return new Proxy({}, handler) }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

// Resolve each successive supabase.from() call to the next queued value.
function queue(values: { data: unknown; error: unknown }[]) {
  let i = 0
  mockFrom.mockImplementation(() => chain(values[Math.min(i++, values.length - 1)]))
}

const preset = QUICK_PRESETS[1] // f1b2 — 1 front, 2 back

beforeEach(() => {
  vi.clearAllMocks()
  insertCalls = 0
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  useTemplateStore.setState({ templates: [], loading: false, error: null })
})

describe('useTemplateStore.findOrCreatePresetTemplate', () => {
  it('reuses an existing template of the same shape (no insert)', async () => {
    const existing = { id: 't-exist', name: preset.templateName, user_id: 'u1' }
    queue([{ data: existing, error: null }]) // find → hit
    const tpl = await useTemplateStore.getState().findOrCreatePresetTemplate(preset)
    expect(tpl?.id).toBe('t-exist')
    expect(insertCalls).toBe(0)
  })

  it('creates the template once when none exists', async () => {
    const created = { id: 't-new', name: preset.templateName, user_id: 'u1' }
    queue([
      { data: null, error: null },      // find → miss
      { data: created, error: null },   // insert → created
      { data: [created], error: null }, // fetchTemplates
    ])
    const tpl = await useTemplateStore.getState().findOrCreatePresetTemplate(preset)
    expect(tpl?.id).toBe('t-new')
    expect(insertCalls).toBe(1)
  })

  it('re-reads on a UNIQUE(user_id,name) race instead of failing', async () => {
    const concurrent = { id: 't-race', name: preset.templateName, user_id: 'u1' }
    queue([
      { data: null, error: null },                               // find → miss
      { data: null, error: { message: 'duplicate key value' } }, // insert → UNIQUE violation
      { data: concurrent, error: null },                         // re-read → winner's row
    ])
    const tpl = await useTemplateStore.getState().findOrCreatePresetTemplate(preset)
    expect(tpl?.id).toBe('t-race')
    expect(insertCalls).toBe(1)
  })

  it('returns null when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const tpl = await useTemplateStore.getState().findOrCreatePresetTemplate(preset)
    expect(tpl).toBeNull()
  })
})
