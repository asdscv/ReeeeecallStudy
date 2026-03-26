import type { ICryptoStrategy, IStorageBackend } from './types';
export interface ProviderKeyEntry {
    apiKey: string;
    model: string;
    baseUrl?: string;
    savedAt: string;
}
export type ProviderKeyMap = Record<string, ProviderKeyEntry>;
export interface AIKeyVaultOptions {
    crypto: ICryptoStrategy;
    backend: IStorageBackend;
    storageKey?: string;
}
export declare class AIKeyVault {
    private readonly crypto;
    private readonly backend;
    private readonly storageKey;
    constructor(options: AIKeyVaultOptions);
    /** Load all provider keys */
    loadAll(uid: string): Promise<ProviderKeyMap>;
    /** Load key for a specific provider */
    loadProvider(uid: string, providerId: string): Promise<ProviderKeyEntry | null>;
    /** Save key for a specific provider (preserves others) */
    saveProvider(uid: string, providerId: string, entry: ProviderKeyEntry): Promise<void>;
    /** Remove key for a specific provider */
    removeProvider(uid: string, providerId: string): Promise<void>;
    /** Check if any provider key exists (sync, no decryption) */
    hasAnyKey(): boolean;
    /** Clear all stored keys */
    clear(): void;
    /** Get list of stored provider IDs (requires decryption) */
    getStoredProviderIds(uid: string): Promise<string[]>;
    private saveAll;
    private migrateFromV2;
}
