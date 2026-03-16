import type { IPlatformAdapter } from '@reeeeecall/shared/adapters/platform'
import { Linking, Platform } from 'react-native'

export class RNPlatform implements IPlatformAdapter {
  getOrigin(): string {
    // RN apps don't have a web origin; return deep link scheme
    return 'reeeeecall://'
  }

  async openURL(url: string): Promise<void> {
    await Linking.openURL(url)
  }

  getLocale(): string {
    return Platform.select({ ios: 'en', android: 'en' }) ?? 'en'
  }
}
