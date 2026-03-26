// ── Vault ──────────────────────────────────────────────
const DEFAULT_KEY = 'reeeeecall-ai-keys-v3';
const LEGACY_V2_KEY = 'reeeeecall-ai-config-v2';
const LEGACY_V1_KEY = 'reeeeecall-ai-config';
export class AIKeyVault {
    crypto;
    backend;
    storageKey;
    constructor(options) {
        this.crypto = options.crypto;
        this.backend = options.backend;
        this.storageKey = options.storageKey ?? DEFAULT_KEY;
    }
    /** Load all provider keys */
    async loadAll(uid) {
        const raw = this.backend.getItem(this.storageKey);
        if (raw) {
            try {
                const envelope = JSON.parse(raw);
                const decrypted = await this.crypto.decrypt(envelope.data, uid);
                return JSON.parse(decrypted);
            }
            catch {
                this.backend.removeItem(this.storageKey);
            }
        }
        // Attempt migration from v2 single-config format
        return this.migrateFromV2(uid);
    }
    /** Load key for a specific provider */
    async loadProvider(uid, providerId) {
        const all = await this.loadAll(uid);
        return all[providerId] ?? null;
    }
    /** Save key for a specific provider (preserves others) */
    async saveProvider(uid, providerId, entry) {
        const all = await this.loadAll(uid);
        all[providerId] = entry;
        await this.saveAll(uid, all);
    }
    /** Remove key for a specific provider */
    async removeProvider(uid, providerId) {
        const all = await this.loadAll(uid);
        delete all[providerId];
        await this.saveAll(uid, all);
    }
    /** Check if any provider key exists (sync, no decryption) */
    hasAnyKey() {
        return (this.backend.getItem(this.storageKey) !== null ||
            this.backend.getItem(LEGACY_V2_KEY) !== null ||
            this.backend.getItem(LEGACY_V1_KEY) !== null);
    }
    /** Clear all stored keys */
    clear() {
        this.backend.removeItem(this.storageKey);
        this.backend.removeItem(LEGACY_V2_KEY);
        this.backend.removeItem(LEGACY_V1_KEY);
    }
    /** Get list of stored provider IDs (requires decryption) */
    async getStoredProviderIds(uid) {
        const all = await this.loadAll(uid);
        return Object.keys(all);
    }
    // ── Private ──────────────────────────────────────────
    async saveAll(uid, keys) {
        const plaintext = JSON.stringify(keys);
        const encrypted = await this.crypto.encrypt(plaintext, uid);
        const envelope = {
            v: 1,
            data: encrypted,
            storedAt: new Date().toISOString(),
            ttlMs: null,
        };
        this.backend.setItem(this.storageKey, JSON.stringify(envelope));
    }
    async migrateFromV2(uid) {
        // Try v2 (single encrypted config)
        const v2Raw = this.backend.getItem(LEGACY_V2_KEY);
        if (v2Raw) {
            try {
                const envelope = JSON.parse(v2Raw);
                const decrypted = await this.crypto.decrypt(envelope.data, uid);
                const config = JSON.parse(decrypted);
                if (config.apiKey) {
                    const keys = {
                        [config.providerId]: {
                            apiKey: config.apiKey,
                            model: config.model,
                            baseUrl: config.baseUrl,
                            savedAt: envelope.storedAt,
                        },
                    };
                    await this.saveAll(uid, keys);
                    this.backend.removeItem(LEGACY_V2_KEY);
                    return keys;
                }
            }
            catch {
                this.backend.removeItem(LEGACY_V2_KEY);
            }
        }
        // Try v1 (plaintext)
        const v1Raw = this.backend.getItem(LEGACY_V1_KEY);
        if (v1Raw) {
            try {
                const config = JSON.parse(v1Raw);
                if (config.apiKey) {
                    const keys = {
                        [config.providerId]: {
                            apiKey: config.apiKey,
                            model: config.model,
                            baseUrl: config.baseUrl,
                            savedAt: new Date().toISOString(),
                        },
                    };
                    await this.saveAll(uid, keys);
                    this.backend.removeItem(LEGACY_V1_KEY);
                    return keys;
                }
            }
            catch {
                this.backend.removeItem(LEGACY_V1_KEY);
            }
        }
        return {};
    }
}
//# sourceMappingURL=ai-key-vault.js.map