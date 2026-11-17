import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const url = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const itLocal = anonKey && serviceKey ? it : it.skip
const created: string[] = []
let admin: SupabaseClient, client: SupabaseClient, stranger: SupabaseClient
let userId: string, setId: string

async function user() {
  const email = `quiz-audit-${randomUUID()}@test.local`
  const password = randomUUID()
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw result.error ?? new Error('Missing test user')
  created.push(result.data.user.id)
  const authenticated = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await authenticated.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  return { id: result.data.user.id, client: authenticated }
}

beforeAll(async () => {
  if (!anonKey || !serviceKey) return
  admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const owner = await user(); userId = owner.id; client = owner.client
  stranger = (await user()).client
  const template = await client.from('card_templates').select('id').eq('user_id', userId).eq('name', '영어 단어').single()
  if (template.error) throw template.error
  const deck = await client.from('decks').insert({ user_id: userId, name: 'Quiz lifecycle', default_template_id: template.data.id }).select('id').single()
  if (deck.error) throw deck.error
  const card = await client.from('cards').insert({ user_id: userId, deck_id: deck.data.id, template_id: template.data.id, field_values: { field_1: 'prompt', field_2: 'right' } }).select('id').single()
  if (card.error) throw card.error
  const set = await admin.from('quiz_sets').insert({ owner_user_id: userId, deck_id: deck.data.id, title: 'Lifecycle', question_type: 'mcq', scope_kind: 'deck', requested_count: 1, generated_count: 1, content_locale: 'en' }).select('id').single()
  if (set.error) throw set.error
  setId = set.data.id
  const question = await admin.from('quiz_questions').insert({ set_id: setId, owner_user_id: userId, card_id: card.data.id, question_type: 'mcq', position: 0, stem: 'Choose the answer', options: ['right', 'wrong A', 'wrong B', 'wrong C'], correct_index: 0, reference_answer: 'right', source_fingerprint: 'lifecycle' })
  if (question.error) throw question.error
})

afterAll(async () => {
  for (const id of created) {
    const deletion = await admin.auth.admin.deleteUser(id)
    if (deletion.error) throw deletion.error
  }
})

async function start() {
  const result = await client.rpc('start_quiz_run', { p_set_id: setId })
  expect(result.error).toBeNull()
  const runId = result.data.run_id as string
  const items = await client.rpc('get_quiz_run_items', { p_run_id: runId })
  expect(items.error).toBeNull()
  return { runId, item: items.data.items[0] }
}

describe('authenticated quiz lifecycle', () => {
  itLocal('allocates unique sitting numbers under simultaneous HTTP requests', async () => {
    const results = await Promise.all(Array.from({ length: 24 }, () => client.rpc('start_quiz_run', { p_set_id: setId })))
    expect(results.map(r => r.error)).toEqual(Array(24).fill(null))
    expect(new Set(results.map(r => r.data.attempt_no)).size).toBe(24)
  })

  itLocal('withholds the key, grades shuffled choices, and rejects replay without changing totals', async () => {
    const { runId, item } = await start()
    expect(item.reference_answer).toBeNull()
    expect(item.correct_display_index ?? null).toBeNull()
    expect(item.correct_index ?? null).toBeNull()
    const choice = item.options.indexOf('right')
    const response = { p_run_item_id: item.item_id, p_response: { choice }, p_duration_ms: 100 }
    const submitted = await client.rpc('submit_quiz_answer', response)
    expect(submitted.error).toBeNull()
    expect(submitted.data).toMatchObject({ graded: true, score: 1, correct_display_index: choice })
    expect((await client.rpc('submit_quiz_answer', response)).error?.code).toBe('P0011')
    const run = await client.from('quiz_runs').select('score_raw,answered_count').eq('id', runId).single()
    expect(run.data).toEqual({ score_raw: 1, answered_count: 1 })
    const attempts = await admin.from('answer_attempts').select('id').eq('quiz_run_item_id', item.item_id)
    expect(attempts.data).toHaveLength(1)
  })

  itLocal('keeps a closed sitting unchanged and denies a different account', async () => {
    const { runId, item } = await start()
    expect((await stranger.rpc('get_quiz_run_items', { p_run_id: runId })).error?.code).toBe('42501')
    expect((await stranger.rpc('submit_quiz_answer', { p_run_item_id: item.item_id, p_response: { choice: 0 } })).error?.code).toBe('42501')
    expect((await client.rpc('finish_quiz_run', { p_run_id: runId })).error).toBeNull()
    const before = await client.from('quiz_runs').select('*').eq('id', runId).single()
    const rejected = await client.rpc('submit_quiz_answer', { p_run_item_id: item.item_id, p_response: { choice: 0 } })
    expect(rejected.error?.code).toBe('P0011')
    expect((await client.from('quiz_runs').select('*').eq('id', runId).single()).data).toEqual(before.data)
    expect((await admin.from('answer_attempts').select('id').eq('quiz_run_item_id', item.item_id)).data).toHaveLength(0)
  })
})
