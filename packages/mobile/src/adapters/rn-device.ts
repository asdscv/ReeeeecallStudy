import type { IDeviceAdapter } from '@reeeeecall/shared/adapters/device'
import { Platform } from 'react-native'

// TODO: Phase 2 — Enhance with expo-device
export class RNDevice implements IDeviceAdapter {
  private deviceId: string | null = null

  getDeviceId(): string {
    // Synchronous — generates once, caches in memory
    if (!this.deviceId) {
      // TODO: Use expo-secure-store for persistent ID
      this.deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
    return this.deviceId
  }

  getDeviceName(): string {
    return Platform.OS === 'ios' ? 'iOS Device' : 'Android Device'
  }

  getUserAgent(): string {
    return `ReeeeecallStudy/${Platform.OS}`
  }

  getPlatform(): 'ios' | 'android' {
    return Platform.OS as 'ios' | 'android'
  }
}
