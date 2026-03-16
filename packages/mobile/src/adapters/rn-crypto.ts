import type { ICryptoAdapter } from '@reeeeecall/shared/adapters/crypto'

// TODO: Phase 2 — Replace with expo-crypto
export class RNCrypto implements ICryptoAdapter {
  getRandomValues(array: Uint8Array): Uint8Array {
    // expo-crypto provides this
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256)
    }
    return array
  }

  randomUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  get subtle(): ICryptoAdapter['subtle'] {
    // TODO: Implement with expo-crypto
    throw new Error('RN crypto.subtle not yet implemented')
  }
}
