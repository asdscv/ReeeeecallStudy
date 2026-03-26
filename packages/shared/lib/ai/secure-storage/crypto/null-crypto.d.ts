import type { ICryptoStrategy } from '../types';
export declare class NullCrypto implements ICryptoStrategy {
    encrypt(plaintext: string, _uid: string): Promise<string>;
    decrypt(ciphertext: string, _uid: string): Promise<string>;
}
