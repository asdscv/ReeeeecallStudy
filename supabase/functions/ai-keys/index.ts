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
        if (!body.providerId || !body.apiKey) return json({ error: 'providerId and apiKey required' }, 400)
        const { error } = await admin.rpc('upsert_ai_provider_key_secure', {
          p_user_id: userId,
          p_provider_id: body.providerId,
          p_api_key: body.apiKey,
          p_model: body.model ?? null,
          p_base_url: body.baseUrl ?? null,
          p_passphrase: passphrase,
        })
        if (error) { console.error('[ai-keys] upsert:', error.message); return json({ error: 'upsert failed' }, 500) }
        return json({ ok: true })
      }
      case 'delete': {
        if (!body.providerId) return json({ error: 'providerId required' }, 400)
        const { error } = await admin.rpc('delete_ai_provider_key_secure', {
          p_user_id: userId,
          p_provider_id: body.providerId,
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
