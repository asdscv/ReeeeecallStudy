/**
 * Platform-agnostic audio playback interface
 * Web: HTMLAudioElement
 * Mobile: expo-av
 */
export interface IAudioAdapter {
  play(url: string): Promise<void>
  stop(): void
}
