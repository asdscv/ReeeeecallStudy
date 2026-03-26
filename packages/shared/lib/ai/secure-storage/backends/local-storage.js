export class LocalStorageBackend {
    getItem(key) {
        try {
            return localStorage.getItem(key);
        }
        catch {
            return null;
        }
    }
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
        }
        catch {
            // private browsing — silently fail
        }
    }
    removeItem(key) {
        try {
            localStorage.removeItem(key);
        }
        catch {
            // private browsing
        }
    }
}
//# sourceMappingURL=local-storage.js.map