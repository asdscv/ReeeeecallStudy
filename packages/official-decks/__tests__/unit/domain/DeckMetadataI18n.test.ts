import { describe, it, expect } from "vitest";
import { parseLanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";
import { buildDeckMetadata } from "@/domain/services/DeckMetadataBuilder";
import {
  audienceLanguage,
  localizedDeckName,
  localizedDeckDescription,
} from "@/domain/services/DeckMetadataI18n";

const code = parseLanguageCode;
const NON_EN = ["ko", "ja", "zh", "es", "vi", "th", "id"] as const;

describe("DeckMetadataI18n", () => {
  it("audienceLanguage = the non-English side of the pair", () => {
    expect(audienceLanguage(code("en"), code("ko"))).toBe("ko");
    expect(audienceLanguage(code("ko"), code("en"))).toBe("ko");
    expect(audienceLanguage(code("en"), code("ja"))).toBe("ja");
  });

  it("forward and reverse decks share a base name but differ by direction", () => {
    const fwd = localizedDeckName("beginner", "batch-1", code("en"), code("ko"));
    const rev = localizedDeckName("beginner", "batch-1", code("ko"), code("en"));
    expect(fwd).toBe("초급 영단어 — 1탄 (영어 → 한국어)");
    expect(rev).toBe("초급 영단어 — 1탄 (한국어 → 영어)");
  });

  it("renders each non-English audience language natively (no ASCII direction arrow)", () => {
    for (const lang of NON_EN) {
      const name = localizedDeckName(
        "beginner",
        "batch-2",
        code("en"),
        code(lang),
      );
      // No leftover English-pair arrow like "(EN → KO)".
      expect(name).not.toMatch(/\(EN →|→ [A-Z]{2}\)/);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("localizes exam decks while preserving the exam name + score", () => {
    expect(localizedDeckName("ielts", "7.0", code("en"), code("ja"))).toContain(
      "IELTS 7.0",
    );
    expect(localizedDeckName("toefl", "100", code("en"), code("zh"))).toContain(
      "TOEFL 100",
    );
    expect(localizedDeckName("toeic", "990", code("en"), code("es"))).toContain(
      "TOEIC 990",
    );
  });

  it("localizes conversation decks and keeps the original label", () => {
    const name = localizedDeckName("conversation", "시사", code("ko"), code("en"));
    expect(name).toBe("실전 영어 회화 — 시사 (한국어 → 영어)");
  });

  it("produces a non-empty description per category in the audience language", () => {
    expect(localizedDeckDescription("beginner", "batch-1", code("en"), code("ko"))).toContain(
      "영어",
    );
    expect(localizedDeckDescription("ielts", "7.0", code("en"), code("ja"))).toContain(
      "IELTS",
    );
    expect(
      localizedDeckDescription("conversation", "여행", code("ko"), code("en")).length,
    ).toBeGreaterThan(0);
  });

  it("regression: buildDeckMetadata never emits an English '(XX → YY)' direction arrow", () => {
    const fixtures: Array<[string, string, string]> = [
      ["beginner_batch1.csv", "en", "ko"],
      ["beginner_batch1.csv", "ko", "en"],
      ["intermediate_batch5.csv", "en", "ja"],
      ["advanced_batch9.csv", "en", "es"],
      ["ielts-7.0-1500.csv", "en", "vi"],
      ["toeic-990-1500.csv", "en", "th"],
      ["english-beginner-1000.csv", "en", "id"],
      ["real-conversation-시사.csv", "ko", "en"],
    ];
    for (const [file, s, t] of fixtures) {
      const meta = buildDeckMetadata(file, LanguagePair.of(code(s), code(t)));
      // The old format embedded an uppercase ISO arrow, e.g. "(EN → KO)".
      expect(meta.name).not.toMatch(/\([A-Z]{2} → [A-Z]{2}\)/);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});
