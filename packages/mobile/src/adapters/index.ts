import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { initAdapters } from '@reeeeecall/shared/adapters'
import { RNStorage, RNSessionStorage, supabaseSecureStorage } from './rn-storage'
import { RNCrypto } from './rn-crypto'
import { RNDevice } from './rn-device'
import { RNTTS } from './rn-tts'
import { RNAudio } from './rn-audio'
import { RNPlatform } from './rn-platform'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

let _supabase: SupabaseClient | null = null

/**
 * Initialize all platform adapters and Supabase client.
 * Must be called before any shared code that depends on adapters or Supabase.
 */
export function initMobilePlatform(): void {
  // Initialize platform adapters
  initAdapters({
    storage: new RNStorage(),
    sessionStorage: new RNSessionStorage(),
    crypto: new RNCrypto(),
    device: new RNDevice(),
    tts: new RNTTS(),
    audio: new RNAudio(),
    platform: new RNPlatform(),
  })
}

/**
 * Get the mobile Supabase client (lazy-initialized with SecureStore).
 * RN requires detectSessionInUrl: false and custom async storage.
 */
export function getMobileSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Add them to your .env file.',
      )
    }

    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: supabaseSecureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  }
  return _supabase
}
