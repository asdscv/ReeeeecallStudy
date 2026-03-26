import type { AIConfig } from '../types';
export interface IStorageBackend {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface ICryptoStrategy {
    encrypt(plaintext: string, uid: string): Promise<string>;
    decrypt(ciphertext: string, uid: string): Promise<string>;
}
export interface SecureEnvelope {
    /** Schema version for forward compatibility */
    v: 1;
    /** Encrypted payload (base64-encoded) */
    data: string;
    /** ISO 8601 timestamp of when the key was stored */
    storedAt: string;
    /** TTL in milliseconds. null = no expiry. */
    ttlMs: number | null;
}
export interface AIConfigManagerOptions {
    crypto: ICryptoStrategy;
    backend: IStorageBackend;
    storageKey?: string;
    defaultTtlMs?: number | null;
}
export interface IAIConfigManager {
    load(uid: string): Promise<AIConfig | null>;
    save(uid: string, config: AIConfig, ttlMs?: number | null): Promise<void>;
    clear(): void;
    hasKey(): boolean;
}
