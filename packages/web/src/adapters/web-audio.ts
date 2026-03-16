import type { IAudioAdapter } from '@reeeeecall/shared/adapters/audio'

export class WebAudio implements IAudioAdapter {
  private activeAudio: HTMLAudioElement | null = null

  async play(url: string): Promise<void> {
    this.stop()
    const audio = new Audio(url)
    this.activeAudio = audio
    audio.onended = () => { this.activeAudio = null }
    await audio.play().catch(() => {})
  }

  stop(): void {
    if (this.activeAudio) {
      this.activeAudio.pause()
      this.activeAudio.currentTime = 0
      this.activeAudio = null
    }
  }
}
