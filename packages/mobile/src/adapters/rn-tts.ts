import * as Speech from 'expo-speech'
import { setAudioModeAsync } from 'expo-audio'
import { Platform } from 'react-native'
import type { ITTSAdapter } from '@reeeeecall/shared/adapters/tts'

let audioSessionReady = false

export class RNTTS implements ITTSAdapter {
  async speak(text: string, lang: string, rate: number = 0.9): Promise<void> {
    if (!this.isSupported()) return
    // iOS: set audio session to playback so TTS plays through speaker
    // even when the silent mode switch is on
    if (Platform.OS === 'ios' && !audioSessionReady) {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
        })
        audioSessionReady = true
      } catch {}
    }
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
