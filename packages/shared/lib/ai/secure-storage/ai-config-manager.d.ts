import type { AIConfig } from '../types';
import type { IAIConfigManager, AIConfigManagerOptions } from './types';
export declare class AIConfigManager implements IAIConfigManager {
    private readonly crypto;
    private readonly backend;
    private readonly storageKey;
    private readonly defaultTtlMs;
    constructor(options: AIConfigManagerOptions);
    load(uid: string): Promise<AIConfig | null>;
    save(uid: string, config: AIConfig, ttlMs?: number | null): Promise<void>;
    clear(): void;
    hasKey(): boolean;
    private migrateFromLegacy;
    private isExpired;
}
