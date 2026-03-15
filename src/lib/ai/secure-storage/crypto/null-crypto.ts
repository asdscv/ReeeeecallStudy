import type { ICryptoStrategy } from '../types'

export class NullCrypto implements ICryptoStrategy {
  async encrypt(plaintext: string, _uid: string): Promise<string> {
    return plaintext
  }

  async decrypt(ciphertext: string, _uid: string): Promise<string> {
    return ciphertext
  }
}
