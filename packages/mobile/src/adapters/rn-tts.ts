import type { ITTSAdapter } from '@reeeeecall/shared/adapters/tts'

// TODO: Phase 4 — Replace with expo-speech
export class RNTTS implements ITTSAdapter {
  async speak(_text: string, _lang: string, _rate?: number): Promise<void> {
    // Will use expo-speech
    console.log('[TTS] Not yet implemented for RN')
  }

  stop(): void {
    // Will use Speech.stop()
  }

  isSupported(): boolean {
    return false // Enable when expo-speech is integrated
  }
}
