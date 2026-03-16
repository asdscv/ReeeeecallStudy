import type { ITTSAdapter } from '@reeeeecall/shared/adapters/tts'

export class WebTTS implements ITTSAdapter {
  async speak(text: string, lang: string, rate: number = 0.9): Promise<void> {
    if (!this.isSupported()) return

    this.stop()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = rate
    utterance.pitch = 1.0
    utterance.volume = 1.0
    window.speechSynthesis.speak(utterance)
  }

  stop(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }

  isSupported(): boolean {
    return 'speechSynthesis' in window
  }
}
