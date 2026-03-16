/**
 * Platform-agnostic device info interface
 * Web: navigator.userAgent, crypto.randomUUID
 * Mobile: expo-device, expo-crypto
 */
export interface IDeviceAdapter {
  getDeviceId(): string
  getDeviceName(): string
  getUserAgent(): string
  getPlatform(): 'ios' | 'android' | 'web'
}
