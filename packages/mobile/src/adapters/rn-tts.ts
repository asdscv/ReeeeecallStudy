import * as Speech from 'expo-speech'
import type { ITTSAdapter } from '@reeeeecall/shared/adapters/tts'

export class RNTTS implements ITTSAdapter {
  async speak(text: string, lang: string, rate: number = 0.9): Promise<void> {
    if (!this.isSupported()) return
    this.stop()
    Speech.speak(text, { language: lang, rate, pitch: 1.0 })
  }

  stop(): void {
    Speech.stop()
  }

  isSupported(): boolean {
    return true // expo-speech is always available on iOS/Android
  }
}
