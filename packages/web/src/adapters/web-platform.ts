import type { IPlatformAdapter } from '@reklue/shared/adapters/platform'

export class WebPlatform implements IPlatformAdapter {
  getOrigin(): string {
    return window.location.origin
  }

  openURL(url: string): void {
    window.open(url, '_blank')
  }

  getLocale(): string {
    return navigator.language ?? 'en'
  }
}
