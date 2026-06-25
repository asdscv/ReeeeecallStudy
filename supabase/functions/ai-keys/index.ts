// Edge function: AI provider key vault (H1 — passphrase out of the DB).
//
// The AES passphrase used to encrypt user AI provider keys now lives ONLY as the
// AI_KEY_PASSPHRASE edge secret (no longer in the public._ai_encryption_config
// table). This function verifies the caller's JWT, then calls the service-role-
// only *_secure DB functions (migration 104) passing the passphrase, so pgcrypto
// stays in the DB (existing encrypted_api_key rows decrypt unchanged) while a DB
// dump alone can no longer reveal the passphrase.
//
// POST body: { action: 'list' | 'upsert' | 'delete', providerId?, apiKey?, model?, baseUrl? }

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

// Input bounds for the (now public, JWT-gated) HTTP surface — guard the DB from
// oversized blobs / unbounded distinct rows and the NOT NULL columns from nulls.
const MAX_PROVIDER_ID = 64
const MAX_API_KEY = 8192
const MAX_MODEL = 256
const MAX_BASE_URL = 2048

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user } } = await sb.auth.getUser(token)
  return user?.id ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const userId = await verifyUser(req.headers.get('Authorization'))
    if (!userId) return json({ error: 'Unauthorized' }, 401)

    const passphrase = Deno.env.get('AI_KEY_PASSPHRASE')
    if (!passphrase) {
      console.error('[ai-keys] AI_KEY_PASSPHRASE not configured')
      return json({ error: 'Server not configured' }, 500)
    }

    const body = await req.json().catch(() => ({})) as {
      action?: string
      providerId?: string
      apiKey?: string
      model?: string
      baseUrl?: string
    }

    // service-role client to call the *_secure functions (passphrase as arg).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    switch (body.action) {
      case 'list': {
        const { data, error } = await admin.rpc('get_ai_provider_keys_secure', {
          p_user_id: userId,
          p_passphrase: passphrase,
        })
        if (error) { console.error('[ai-keys] list:', error.message); return json({ error: 'list failed' }, 500) }
        return json({ keys: data ?? [] })
      }
      case 'upsert': {
        // providerId + apiKey required (NOT NULL); model is NOT NULL → coerce ''
        // (never null); baseUrl is nullable → null when empty. All length-capped.
        const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
        const model = typeof body.model === 'string' ? body.model : ''
        const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
        if (!providerId || providerId.length > MAX_PROVIDER_ID) return json({ error: 'invalid providerId' }, 400)
        if (!apiKey || apiKey.length > MAX_API_KEY) return json({ error: 'invalid apiKey' }, 400)
        if (model.length > MAX_MODEL) return json({ error: 'invalid model' }, 400)
        if (baseUrl.length > MAX_BASE_URL) return json({ error: 'invalid baseUrl' }, 400)

        const { error } = await admin.rpc('upsert_ai_provider_key_secure', {
          p_user_id: userId,
          p_provider_id: providerId,
          p_api_key: apiKey,
          p_model: model,
          p_base_url: baseUrl || null,
          p_passphrase: passphrase,
        })
        if (error) { console.error('[ai-keys] upsert:', error.message); return json({ error: 'upsert failed' }, 500) }
        return json({ ok: true })
      }
      case 'delete': {
        const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
        if (!providerId || providerId.length > MAX_PROVIDER_ID) return json({ error: 'invalid providerId' }, 400)
        const { error } = await admin.rpc('delete_ai_provider_key_secure', {
          p_user_id: userId,
          p_provider_id: providerId,
        })
        if (error) { console.error('[ai-keys] delete:', error.message); return json({ error: 'delete failed' }, 500) }
        return json({ ok: true })
      }
      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    console.error('[ai-keys] error:', e)
    return json({ error: 'ai-keys failed' }, 500)
  }
})
