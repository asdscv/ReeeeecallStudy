import { v5 as uuidv5 } from "uuid";
import type { ManifestKey } from "@/domain/value-objects/ManifestKey";

/**
 * Two app-specific UUIDv5 namespaces. These MUST match the constants used in
 * supabase migration 082 (import_official_deck RPC).
 *
 * Changing either breaks idempotency for existing data.
 */
export const DECK_NAMESPACE = "6f7d8a9b-3c4e-4d6f-8a8b-9c0d1e2f3a4b" as const;
export const CARD_NAMESPACE = "7e8f9a0b-1c2d-4e4f-8a6b-7c8d9e0f1a2b" as const;

export function computeDeckId(manifestKey: ManifestKey): string {
  return uuidv5(manifestKey.toString(), DECK_NAMESPACE);
}

export function computeCardId(deckId: string, rowIndex: number): string {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error(`rowIndex must be a non-negative integer, got ${rowIndex}`);
  }
  return uuidv5(`${deckId}:${rowIndex}`, CARD_NAMESPACE);
}
