import { initAdapters } from '@reeeeecall/shared/adapters'
import { initSupabase } from '@reeeeecall/shared/lib/supabase'
import { RNStorage, RNSessionStorage } from './rn-storage'
import { RNCrypto } from './rn-crypto'
import { RNDevice } from './rn-device'
import { RNTTS } from './rn-tts'
import { RNAudio } from './rn-audio'
import { RNPlatform } from './rn-platform'

// TODO: Move to environment config (expo-constants or .env)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

export function initMobilePlatform(): void {
  // Initialize Supabase
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY)
  }

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
