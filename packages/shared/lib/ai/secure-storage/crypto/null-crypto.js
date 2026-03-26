export class NullCrypto {
    async encrypt(plaintext, _uid) {
        return plaintext;
    }
    async decrypt(ciphertext, _uid) {
        return ciphertext;
    }
}
//# sourceMappingURL=null-crypto.js.map