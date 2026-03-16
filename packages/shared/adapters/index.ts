import type { IStorage, ISessionStorage } from './storage.ts'
import type { ICryptoAdapter } from './crypto.ts'
import type { IDeviceAdapter } from './device.ts'
import type { ITTSAdapter } from './tts.ts'
import type { IAudioAdapter } from './audio.ts'
import type { IPlatformAdapter } from './platform.ts'

export type { IStorage, ISessionStorage } from './storage.ts'
export type { ICryptoAdapter } from './crypto.ts'
export type { IDeviceAdapter } from './device.ts'
export type { ITTSAdapter } from './tts.ts'
export type { IAudioAdapter } from './audio.ts'
export type { IPlatformAdapter } from './platform.ts'

interface AdapterConfig {
  storage: IStorage
  sessionStorage: ISessionStorage
  crypto: ICryptoAdapter
  device: IDeviceAdapter
  tts: ITTSAdapter
  audio: IAudioAdapter
  platform: IPlatformAdapter
}

let _adapters: AdapterConfig | null = null

export function initAdapters(adapters: AdapterConfig): void {
  _adapters = adapters
}

function ensureInit(): AdapterConfig {
  if (!_adapters) {
    throw new Error('Adapters not initialized. Call initAdapters() first.')
  }
  return _adapters
}

export function getStorage(): IStorage {
  return ensureInit().storage
}

export function getSessionStorage(): ISessionStorage {
  return ensureInit().sessionStorage
}

export function getCrypto(): ICryptoAdapter {
  return ensureInit().crypto
}

export function getDevice(): IDeviceAdapter {
  return ensureInit().device
}

export function getTTS(): ITTSAdapter {
  return ensureInit().tts
}

export function getAudio(): IAudioAdapter {
  return ensureInit().audio
}

export function getPlatform(): IPlatformAdapter {
  return ensureInit().platform
}
