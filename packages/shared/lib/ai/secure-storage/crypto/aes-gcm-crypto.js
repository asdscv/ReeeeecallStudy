const APP_SALT = 'reeeeecall-ai-key-v1';
const ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
export class AesGcmCrypto {
    async encrypt(plaintext, uid) {
        const key = await this.deriveKey(uid);
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        // Prepend IV to ciphertext
        const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), IV_LENGTH);
        return this.toBase64(combined);
    }
    async decrypt(ciphertext, uid) {
        const key = await this.deriveKey(uid);
        const combined = this.fromBase64(ciphertext);
        const iv = combined.slice(0, IV_LENGTH);
        const data = combined.slice(IV_LENGTH);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return new TextDecoder().decode(decrypted);
    }
    async deriveKey(uid) {
        const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(uid), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({
            name: 'PBKDF2',
            salt: new TextEncoder().encode(APP_SALT),
            iterations: ITERATIONS,
            hash: 'SHA-256',
        }, keyMaterial, { name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
    }
    toBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    fromBase64(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}
//# sourceMappingURL=aes-gcm-crypto.js.map