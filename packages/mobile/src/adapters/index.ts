import { initAdapters } from '@reeeeecall/shared/adapters'
import { initSupabase, getSupabase } from '@reeeeecall/shared/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Appearance } from 'react-native'
import { RNStorage, RNSessionStorage, supabaseSecureStorage } from './rn-storage'
import { RNCrypto } from './rn-crypto'
import { RNDevice } from './rn-device'
import { RNTTS } from './rn-tts'
import { RNAudio } from './rn-audio'
import { RNPlatform } from './rn-platform'

// 환경변수 resolve 우선순위:
//   1) process.env.EXPO_PUBLIC_* — expo start / expo run 에서 .env 직접 읽을 때
//   2) Constants.expoConfig.extra.* — eas build에서 app.config.js가 빌드 시점에 임베드한 값
// 어떤 빌드 방식이든 최소 하나는 값이 있음.
const extra = Constants.expoConfig?.extra ?? {}
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || ''
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || ''

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

  // Fail loudly if env vars are missing — prevents silent crash on device.
  // 원인: .env가 빌드 아카이브에 포함되지 않으면 EXPO_PUBLIC_* 가 빈 문자열.
  // 해결: .easignore에서 .env를 제외하지 않도록 설정 (packages/mobile/.easignore 참조).
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const msg = '[FATAL] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. '
      + 'Ensure .env file is included in the build archive (.easignore must not exclude .env).'
    console.error(msg)
    throw new Error(msg)
  }

  // Initialize shared Supabase client with mobile-compatible auth storage
  // This single client is used by ALL shared stores (deck-store, card-store, etc.)
  initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: supabaseSecureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 테마 즉시 적용 — React 렌더 전, 동기적으로 실행.
  // SecureStore.getItem()은 동기 API. 이전에 저장된 테마를 즉시 읽어서
  // Appearance.setColorScheme()으로 OS 레벨에 적용.
  // → useColorScheme() 훅이 첫 렌더부터 올바른 값 반환.
  // DB 테마와의 동기화는 prefetch 'profile' 태스크가 처리.
  // ─────────────────────────────────────────────────────────────────────
  try {
    const cachedTheme = SecureStore.getItem('reeeeecall-user-theme')
    if (cachedTheme === 'light' || cachedTheme === 'dark') {
      Appearance.setColorScheme(cachedTheme)
    }
  } catch {
    // SecureStore 접근 실패 시 OS 기본 테마 사용
  }
}

/**
 * Get the mobile Supabase client.
 * Uses the shared client initialized by initMobilePlatform().
 */
export function getMobileSupabase(): SupabaseClient {
  return getSupabase()
}
