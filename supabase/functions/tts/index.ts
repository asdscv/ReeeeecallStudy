// Edge TTS Supabase Function
// Synthesizes speech using Microsoft Edge's Read Aloud TTS (free, unofficial)
//
// POST /tts  { text, lang, voice? }  →  audio/mpeg binary

import { createClient } from '@supabase/supabase-js'

// ── Constants ────────────────────────────────────────────────
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=`

// Default voices per language (all Neural)
const DEFAULT_VOICES: Record<string, string> = {
  'ko-KR': 'ko-KR-SunHiNeural',
  'en-US': 'en-US-AriaNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'pt-BR': 'pt-BR-FranciscaNeural',
  'vi-VN': 'vi-VN-HoaiMyNeural',
  'th-TH': 'th-TH-PremwadeeNeural',
  'id-ID': 'id-ID-GadisNeural',
}

const MAX_TEXT_LENGTH = 2000
const WS_TIMEOUT_MS = 10_000

// ── CORS ────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

// ── Edge TTS synthesis via WebSocket ────────────────────────
function escapeSSML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSSML(text: string, voice: string, rate: number, pitch: number): string {
  // Rate: +0% is normal, -50% is half speed, +100% is double
  const ratePercent = Math.round((rate - 1) * 100)
  const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`
  const pitchStr = pitch >= 1 ? `+${Math.round((pitch - 1) * 50)}Hz` : `-${Math.round((1 - pitch) * 50)}Hz`

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
    <voice name='${voice}'>
      <prosody rate='${rateStr}' pitch='${pitchStr}'>
        ${escapeSSML(text)}
      </prosody>
    </voice>
  </speak>`
}

async function synthesizeEdgeTTS(
  text: string,
  voice: string,
  rate: number = 1.0,
  pitch: number = 1.0,
): Promise<Uint8Array> {
  const connectionId = crypto.randomUUID().replace(/-/g, '')

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      reject(new Error('Edge TTS timeout'))
    }, WS_TIMEOUT_MS)

    const audioChunks: Uint8Array[] = []
    const ws = new WebSocket(WSS_URL + connectionId)

    ws.onopen = () => {
      // 1) Send speech config
      const configMessage =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        })
      ws.send(configMessage)

      // 2) Send SSML
      const ssml = buildSSML(text, voice, rate, pitch)
      const ssmlMessage =
        `X-RequestId:${connectionId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml
      ws.send(ssmlMessage)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary message: extract audio data after header
        const view = new DataView(event.data)
        const headerLength = view.getInt16(0)
        if (event.data.byteLength > headerLength + 2) {
          audioChunks.push(new Uint8Array(event.data, headerLength + 2))
        }
      } else if (typeof event.data === 'string') {
        // Text message: check for turn.end
        if (event.data.includes('Path:turn.end')) {
          clearTimeout(timeout)
          ws.close()

          // Merge chunks
          const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const result = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of audioChunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          resolve(result)
        }
      }
    }

    ws.onerror = (err) => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket error: ${err}`))
    }

    ws.onclose = (event) => {
      clearTimeout(timeout)
      if (audioChunks.length === 0) {
        reject(new Error(`WebSocket closed without audio (code: ${event.code})`))
      }
    }
  })
}

// ── Auth helper ─────────────────────────────────────────────
async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user?.id ?? null
}

// ── Main handler ────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Auth check
    const userId = await verifyUser(req.headers.get('Authorization'))
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { text, lang, voice, rate, pitch } = body as {
      text?: string
      lang?: string
      voice?: string
      rate?: number
      pitch?: number
    }

    if (!text || text.length === 0) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return new Response(JSON.stringify({ error: `text too long (max ${MAX_TEXT_LENGTH})` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resolvedLang = lang || 'en-US'
    const resolvedVoice = voice || DEFAULT_VOICES[resolvedLang] || DEFAULT_VOICES['en-US']
    const resolvedRate = Math.max(0.5, Math.min(2.0, rate ?? 1.0))
    const resolvedPitch = Math.max(0.5, Math.min(2.0, pitch ?? 1.0))

    const audio = await synthesizeEdgeTTS(text, resolvedVoice, resolvedRate, resolvedPitch)

    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    console.error('[tts] Error:', err)
    return new Response(JSON.stringify({ error: 'TTS synthesis failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
