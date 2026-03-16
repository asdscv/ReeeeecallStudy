/**
 * Platform-agnostic crypto interface
 * Web: Web Crypto API (crypto.subtle, crypto.getRandomValues)
 * Mobile: expo-crypto
 */
export interface ICryptoAdapter {
  getRandomValues(array: Uint8Array): Uint8Array
  randomUUID(): string
  subtle: {
    digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>
    encrypt(algorithm: AesGcmParams, key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer>
    decrypt(algorithm: AesGcmParams, key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer>
    importKey(
      format: string,
      keyData: ArrayBuffer,
      algorithm: AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[],
    ): Promise<CryptoKey>
    deriveKey(
      algorithm: Pbkdf2Params,
      baseKey: CryptoKey,
      derivedKeyType: AesDerivedKeyParams,
      extractable: boolean,
      keyUsages: KeyUsage[],
    ): Promise<CryptoKey>
  }
}

interface AesGcmParams {
  name: string
  iv: Uint8Array
}

interface Pbkdf2Params {
  name: string
  salt: Uint8Array
  iterations: number
  hash: string
}

interface AesDerivedKeyParams {
  name: string
  length: number
}
