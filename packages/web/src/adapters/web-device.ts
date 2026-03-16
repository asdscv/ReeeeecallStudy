import type { IDeviceAdapter } from '@reeeeecall/shared/adapters/device'

const STORAGE_KEY = 'reeeeecall_device_id'

export class WebDevice implements IDeviceAdapter {
  getDeviceId(): string {
    try {
      let id = localStorage.getItem(STORAGE_KEY)
      if (!id) {
        id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
        localStorage.setItem(STORAGE_KEY, id)
      }
      return id
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    }
  }

  getDeviceName(): string {
    try {
      const ua = navigator.userAgent
      if (/iPhone|iPad|iPod/.test(ua)) return 'iOS Device'
      if (/Android/.test(ua)) return 'Android Device'
      if (/Mac/.test(ua)) return 'Mac'
      if (/Windows/.test(ua)) return 'Windows PC'
      if (/Linux/.test(ua)) return 'Linux'
      return 'Unknown Device'
    } catch {
      return 'Unknown Device'
    }
  }

  getUserAgent(): string {
    return navigator.userAgent ?? ''
  }

  getPlatform(): 'web' {
    return 'web'
  }
}
