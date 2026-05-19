import { describe, it, expect } from "vitest";
import { parseLanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";
import { ManifestKey } from "@/domain/value-objects/ManifestKey";
import {
  computeDeckId,
  computeCardId,
  DECK_NAMESPACE,
  CARD_NAMESPACE,
} from "@/domain/services/IdentityService";

const pair = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));

describe("IdentityService", () => {
  it("DECK_NAMESPACE is a valid UUID", () => {
    expect(DECK_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("CARD_NAMESPACE is a valid UUID and differs from deck", () => {
    expect(CARD_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(CARD_NAMESPACE).not.toBe(DECK_NAMESPACE);
  });

  it("computeDeckId is deterministic", () => {
    const key = ManifestKey.of("beginner_batch1.csv", pair);
    expect(computeDeckId(key)).toBe(computeDeckId(key));
  });

  it("computeDeckId differs across manifest keys", () => {
    const k1 = ManifestKey.of("beginner_batch1.csv", pair);
    const k2 = ManifestKey.of("beginner_batch2.csv", pair);
    expect(computeDeckId(k1)).not.toBe(computeDeckId(k2));
  });

  it("computeCardId is deterministic given (deckId, rowIndex)", () => {
    const deckId = computeDeckId(ManifestKey.of("beginner_batch1.csv", pair));
    expect(computeCardId(deckId, 0)).toBe(computeCardId(deckId, 0));
  });

  it("computeCardId differs for different row indices", () => {
    const deckId = computeDeckId(ManifestKey.of("beginner_batch1.csv", pair));
    expect(computeCardId(deckId, 0)).not.toBe(computeCardId(deckId, 1));
  });

  it("computeCardId differs across decks even at same index", () => {
    const d1 = computeDeckId(ManifestKey.of("beginner_batch1.csv", pair));
    const d2 = computeDeckId(ManifestKey.of("beginner_batch2.csv", pair));
    expect(computeCardId(d1, 0)).not.toBe(computeCardId(d2, 0));
  });

  it("output is a valid v5 UUID string", () => {
    const id = computeDeckId(ManifestKey.of("beginner_batch1.csv", pair));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("computed deck_id is stable and matches the locked snapshot", () => {
    // The snapshot below is the JS implementation's output. A parallel
    // integration test (`__tests__/integration/postgres-uuidv5-parity.test.ts`)
    // verifies PostgreSQL `uuid_generate_v5` returns this same value, ensuring
    // CLI-computed IDs and DB-computed IDs never drift.
    const key = ManifestKey.of("beginner_batch1.csv", pair);
    const snapshot = "599a2120-4912-5e7f-8f5a-0e453631f247";
    expect(computeDeckId(key)).toBe(snapshot);
  });
});
