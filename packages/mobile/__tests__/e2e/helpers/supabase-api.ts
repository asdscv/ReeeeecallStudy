/**
 * Direct Supabase REST API helper for E2E test data setup/cleanup.
 * Uses the same credentials as the mobile app.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co'
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_4F7XKb_Cifh2rujOiyP9RQ_ZU3HjQsV'

const E2E_EMAIL = process.env.E2E_TEST_EMAIL || 'luke@rictax.kr'
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD || 'qpffkwldh35!'

let cachedToken: string | null = null
let cachedUserId: string | null = null

async function getAuthToken(): Promise<{ token: string; userId: string }> {
  if (cachedToken && cachedUserId) return { token: cachedToken, userId: cachedUserId }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
  })
  const data = await res.json()
  cachedToken = data.access_token
  cachedUserId = data.user?.id
  return { token: cachedToken!, userId: cachedUserId! }
}

function headers(token: string) {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
}

export async function createTestDeck(cards: Array<{ front: string; back: string }>) {
  const { token, userId } = await getAuthToken()
  const hdrs = headers(token)

  // Get default template
  const tmplRes = await fetch(`${SUPABASE_URL}/rest/v1/card_templates?is_default=eq.true&limit=1`, { headers: hdrs })
  const templates = await tmplRes.json()
  const templateId = templates[0]?.id
  if (!templateId) throw new Error('No default template found')

  // Create deck
  const deckRes = await fetch(`${SUPABASE_URL}/rest/v1/decks`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({
      user_id: userId,
      name: '_E2E Study Test',
      icon: '🧪',
      color: '#10B981',
      default_template_id: templateId,
      next_position: cards.length,
    }),
  })
  const deckData = await deckRes.json()
  const deck = Array.isArray(deckData) ? deckData[0] : deckData
  if (!deck?.id) throw new Error(`Failed to create deck: ${JSON.stringify(deckData)}`)

  // Create cards
  const cardRows = cards.map((c, i) => ({
    deck_id: deck.id,
    user_id: userId,
    template_id: templateId,
    field_values: { front: c.front, back: c.back },
    tags: [],
    sort_position: i,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
  }))

  await fetch(`${SUPABASE_URL}/rest/v1/cards`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify(cardRows),
  })

  console.log(`[supabase] Created deck "${deck.name}" (${deck.id}) with ${cards.length} cards`)
  return { deckId: deck.id as string, userId }
}

export async function cleanupTestDeck(deckId: string) {
  const { token } = await getAuthToken()
  const hdrs = headers(token)

  for (const table of ['study_logs', 'study_sessions', 'deck_study_state', 'cards']) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?deck_id=eq.${deckId}`, {
      method: 'DELETE',
      headers: hdrs,
    })
  }
  await fetch(`${SUPABASE_URL}/rest/v1/decks?id=eq.${deckId}`, {
    method: 'DELETE',
    headers: hdrs,
  })
  console.log(`[supabase] Cleaned up deck ${deckId}`)
}

export async function queryCards(deckId: string) {
  const { token } = await getAuthToken()
  const hdrs = headers(token)

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cards?deck_id=eq.${deckId}&select=id,srs_status,ease_factor,interval_days,repetitions,next_review_at&order=sort_position.asc`,
    { headers: hdrs },
  )
  return res.json() as Promise<Array<{
    id: string; srs_status: string; ease_factor: number;
    interval_days: number; repetitions: number; next_review_at: string | null
  }>>
}
