import type { ICryptoStrategy } from '../types';
export declare class AesGcmCrypto implements ICryptoStrategy {
    encrypt(plaintext: string, uid: string): Promise<string>;
    decrypt(ciphertext: string, uid: string): Promise<string>;
    private deriveKey;
    private toBase64;
    private fromBase64;
}
