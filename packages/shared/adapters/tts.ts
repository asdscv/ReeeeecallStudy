/**
 * Platform-agnostic TTS interface
 * Web: Web Speech API (speechSynthesis) + Edge TTS fallback
 * Mobile: expo-speech
 */
export interface ITTSAdapter {
  speak(text: string, lang: string, rate?: number): Promise<void>
  stop(): void
  isSupported(): boolean
}
