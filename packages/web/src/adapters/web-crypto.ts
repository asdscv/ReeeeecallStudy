import type { ICryptoAdapter } from '@reklue/shared/adapters/crypto'

export class WebCrypto implements ICryptoAdapter {
  getRandomValues(array: Uint8Array): Uint8Array {
    return crypto.getRandomValues(array)
  }

  randomUUID(): string {
    return crypto.randomUUID()
  }

  get subtle() {
    return crypto.subtle as ICryptoAdapter['subtle']
  }
}
