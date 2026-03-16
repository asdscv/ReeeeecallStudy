import { initAdapters } from '@reeeeecall/shared/adapters'
import { initSupabase } from '@reeeeecall/shared/lib/supabase'
import { initI18nBridge } from '@reeeeecall/shared/lib/i18n-bridge'
import i18n from '../i18n'
import { WebStorage, WebSessionStorage } from './web-storage'
import { WebCrypto } from './web-crypto'
import { WebDevice } from './web-device'
import { WebTTS } from './web-tts'
import { WebAudio } from './web-audio'
import { WebPlatform } from './web-platform'

export function initWebPlatform(): void {
  // Initialize Supabase with Vite env vars
  initSupabase(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  )

  // Initialize i18n bridge
  initI18nBridge(() => i18n.language)

  // Initialize platform adapters
  initAdapters({
    storage: new WebStorage(),
    sessionStorage: new WebSessionStorage(),
    crypto: new WebCrypto(),
    device: new WebDevice(),
    tts: new WebTTS(),
    audio: new WebAudio(),
    platform: new WebPlatform(),
  })
}
