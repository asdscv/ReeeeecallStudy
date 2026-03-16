import type { IAudioAdapter } from '@reeeeecall/shared/adapters/audio'

// TODO: Phase 4 — Replace with expo-av
export class RNAudio implements IAudioAdapter {
  async play(_url: string): Promise<void> {
    // Will use expo-av Audio.Sound
    console.log('[Audio] Not yet implemented for RN')
  }

  stop(): void {
    // Will use sound.stopAsync()
  }
}
