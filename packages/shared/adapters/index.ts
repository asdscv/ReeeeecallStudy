import type { IStorage, ISessionStorage } from './storage'
import type { ICryptoAdapter } from './crypto'
import type { IDeviceAdapter } from './device'
import type { ITTSAdapter } from './tts'
import type { IAudioAdapter } from './audio'
import type { IPlatformAdapter } from './platform'

export type { IStorage, ISessionStorage } from './storage'
export type { ICryptoAdapter } from './crypto'
export type { IDeviceAdapter } from './device'
export type { ITTSAdapter } from './tts'
export type { IAudioAdapter } from './audio'
export type { IPlatformAdapter } from './platform'

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
