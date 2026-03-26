import type { IStorageBackend } from '../types';
export declare class LocalStorageBackend implements IStorageBackend {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
