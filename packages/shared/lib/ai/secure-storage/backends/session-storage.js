export class SessionStorageBackend {
    getItem(key) {
        try {
            return sessionStorage.getItem(key);
        }
        catch {
            return null;
        }
    }
    setItem(key, value) {
        try {
            sessionStorage.setItem(key, value);
        }
        catch {
            // private browsing — silently fail
        }
    }
    removeItem(key) {
        try {
            sessionStorage.removeItem(key);
        }
        catch {
            // private browsing
        }
    }
}
//# sourceMappingURL=session-storage.js.map