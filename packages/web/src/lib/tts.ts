import { supabase } from './supabase'
import type { Card, CardTemplate, Profile } from '../types/database'

// ── TTS Options (extensible) ──────────────────────────────────
export interface TTSOptions {
  rate?: number    // 0.5 – 2.0 (default 0.9)
  pitch?: number   // 0.5 – 2.0 (default 1.0)
  volume?: number  // 0.0 – 1.0 (default 1.0)
  provider?: 'web_speech' | 'edge_tts'
}

const DEFAULT_TTS_OPTIONS: Required<Omit<TTSOptions, 'provider'>> = {
  rate: 0.9,
  pitch: 1.0,
  volume: 1.0,
}

// ── Active audio (for Edge TTS stop) ──────────────────────────
let activeAudio: HTMLAudioElement | null = null

// ── Edge TTS audio cache (text+lang+rate → blob URL) ──────────
const edgeTTSCache = new Map<string, string>()
const MAX_CACHE_SIZE = 50

function cacheKey(text: string, lang: string, rate: number): string {
  return `${lang}:${rate}:${text}`
}

// ── Main speak function ───────────────────────────────────────
export function speak(text: string, lang: string = 'en-US', options?: TTSOptions): void {
  const provider = options?.provider ?? 'web_speech'

  if (provider === 'edge_tts') {
    speakEdgeTTS(text, lang, options)
    return
  }

  // Web Speech API (default)
  if (!('speechSynthesis' in window)) return

  stopSpeaking()

  const opts = { ...DEFAULT_TTS_OPTIONS, ...options }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = opts.rate
  utterance.pitch = opts.pitch
  utterance.volume = opts.volume
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  // Stop Web Speech API
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  // Stop Edge TTS audio
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.currentTime = 0
    activeAudio = null
  }
}

// ── Edge TTS (via Supabase Function) ──────────────────────────
async function speakEdgeTTS(text: string, lang: string, options?: TTSOptions): Promise<void> {
  stopSpeaking()

  const rate = options?.rate ?? DEFAULT_TTS_OPTIONS.rate
  const pitch = options?.pitch ?? DEFAULT_TTS_OPTIONS.pitch
  const volume = options?.volume ?? DEFAULT_TTS_OPTIONS.volume
  const key = cacheKey(text, lang, rate)

  // Check cache first
  const cached = edgeTTSCache.get(key)
  if (cached) {
    playAudioUrl(cached, volume)
    return
  }

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ text, lang, rate, pitch }),
    })

    if (!res.ok) {
      console.warn('[tts] Edge TTS failed, falling back to Web Speech')
      speak(text, lang, { ...options, provider: 'web_speech' })
      return
    }

    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)

    // Cache (evict oldest if full)
    if (edgeTTSCache.size >= MAX_CACHE_SIZE) {
      const firstKey = edgeTTSCache.keys().next().value
      if (firstKey) {
        const oldUrl = edgeTTSCache.get(firstKey)
        if (oldUrl) URL.revokeObjectURL(oldUrl)
        edgeTTSCache.delete(firstKey)
      }
    }
    edgeTTSCache.set(key, blobUrl)

    playAudioUrl(blobUrl, volume)
  } catch (err) {
    console.warn('[tts] Edge TTS error, falling back to Web Speech:', err)
    speak(text, lang, { ...options, provider: 'web_speech' })
  }
}

function playAudioUrl(url: string, volume: number): void {
  const audio = new Audio(url)
  audio.volume = volume
  activeAudio = audio
  audio.play().catch(() => {})
  audio.onended = () => { activeAudio = null }
}

// ── Profile-based speak ───────────────────────────────────────
export function speakWithProfile(
  text: string,
  profile: Pick<Profile, 'tts_enabled' | 'tts_lang' | 'tts_speed' | 'tts_provider'>,
): void {
  if (!profile.tts_enabled) return
  speak(text, profile.tts_lang, { rate: profile.tts_speed, provider: profile.tts_provider })
}

// ── Card helpers (unchanged) ──────────────────────────────────
export function getCardTTSText(card: Card, template: CardTemplate): string | null {
  // Find the first text field from front_layout
  for (const item of template.front_layout) {
    const field = template.fields.find((f) => f.key === item.field_key)
    if (field && field.type === 'text') {
      const value = card.field_values[field.key]
      if (value) return value
    }
  }
  return null
}

export interface TTSFieldInfo {
  fieldKey: string
  text: string
  lang: string
}

export function getTTSFieldsForLayout(
  card: Card,
  template: CardTemplate,
  side: 'front' | 'back',
): TTSFieldInfo[] {
  const layout = side === 'front' ? template.front_layout : template.back_layout
  const result: TTSFieldInfo[] = []

  for (const item of layout) {
    const field = template.fields.find((f) => f.key === item.field_key)
    if (!field || field.type !== 'text' || !field.tts_enabled) continue

    const value = card.field_values[field.key]
    if (!value) continue

    result.push({
      fieldKey: field.key,
      text: value,
      lang: field.tts_lang || 'en-US',
    })
  }

  return result
}

export function getCardAudioUrl(card: Card, template: CardTemplate): string | null {
  // Find first audio type field that has a URL value
  for (const field of template.fields) {
    if (field.type === 'audio') {
      const url = card.field_values[field.key]
      if (url) return url
    }
  }
  return null
}
