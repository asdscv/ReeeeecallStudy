import { initAdapters } from '@reeeeecall/shared/adapters'
import { initSupabase, getSupabase } from '@reeeeecall/shared/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RNStorage, RNSessionStorage, supabaseSecureStorage } from './rn-storage'
import { RNCrypto } from './rn-crypto'
import { RNDevice } from './rn-device'
import { RNTTS } from './rn-tts'
import { RNAudio } from './rn-audio'
import { RNPlatform } from './rn-platform'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

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

  // Initialize shared Supabase client with mobile-compatible auth storage
  // This single client is used by ALL shared stores (deck-store, card-store, etc.)
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: supabaseSecureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  }
}

/**
 * Get the mobile Supabase client.
 * Uses the shared client initialized by initMobilePlatform().
 */
export function getMobileSupabase(): SupabaseClient {
  return getSupabase()
}
