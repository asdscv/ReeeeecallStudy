import { describe, it, expect } from "vitest";
import { parseLanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";
import { buildDeckMetadata } from "@/domain/services/DeckMetadataBuilder";

const en = parseLanguageCode("en");
const ko = parseLanguageCode("ko");
const ja = parseLanguageCode("ja");
const zh = parseLanguageCode("zh");

describe("DeckMetadataBuilder", () => {
  it("beginner_batch3.csv en→ko → titled and tagged correctly", () => {
    const meta = buildDeckMetadata(
      "beginner_batch3.csv",
      LanguagePair.of(en, ko),
    );
    expect(meta.category).toBe("beginner");
    // Mother-tongue (Korean) title with a localized direction suffix — no English.
    expect(meta.name).toContain("초급");
    expect(meta.name).toContain("3탄");
    expect(meta.name).toContain("(영어 → 한국어)");
    expect(meta.tags).toContain("lang:en-ko");
    expect(meta.tags).toContain("category:beginner");
    expect(meta.tags).toContain("level:batch-3");
    expect(meta.tags).toContain("source:en");
    expect(meta.tags).toContain("target:ko");
    expect(meta.tags).toContain("official");
    // Word deck: learning language is the source (the headword being learned).
    expect(meta.learningLanguage).toBe("en");
    expect(meta.tags).toContain("learning_language:en");
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(meta.icon.length).toBeGreaterThan(0);
  });

  it("ielts-7.0-1500.csv en→ja → level tag = 7.0", () => {
    const meta = buildDeckMetadata("ielts-7.0-1500.csv", LanguagePair.of(en, ja));
    expect(meta.category).toBe("ielts");
    expect(meta.name).toContain("IELTS 7.0");
    expect(meta.tags).toContain("level:7.0");
    expect(meta.tags).toContain("lang:en-ja");
  });

  it("toefl-100-1500.csv en→zh", () => {
    const meta = buildDeckMetadata("toefl-100-1500.csv", LanguagePair.of(en, zh));
    expect(meta.category).toBe("toefl");
    expect(meta.name).toContain("TOEFL 100");
    expect(meta.tags).toContain("level:100");
  });

  it("real-conversation-시사.csv ko→en → phrase template, conversation category", () => {
    const meta = buildDeckMetadata(
      "real-conversation-시사.csv",
      LanguagePair.of(ko, en),
    );
    expect(meta.category).toBe("conversation");
    expect(meta.templateKind).toBe("phrase");
    expect(meta.tags).toContain("level:시사");
    expect(meta.name).toContain("시사");
    // Korean audience, reverse direction rendered in Korean.
    expect(meta.name).toContain("(한국어 → 영어)");
    // Conversation deck: learning language is the target (the English
    // expression being learned), even though source is ko.
    expect(meta.learningLanguage).toBe("en");
    expect(meta.tags).toContain("learning_language:en");
  });

  it("english-beginner-1000.csv en→ko → beginner category, level tag absent", () => {
    const meta = buildDeckMetadata(
      "english-beginner-1000.csv",
      LanguagePair.of(en, ko),
    );
    expect(meta.category).toBe("beginner");
    expect(meta.templateKind).toBe("word");
    // No level tag because english-beginner-1000 has no inferable level
    expect(meta.tags.some((t) => t.startsWith("level:"))).toBe(false);
  });

  describe("nativeLanguages (back-side / explanation language)", () => {
    it("forward EN→KO word → native is the target [ko]", () => {
      const meta = buildDeckMetadata("beginner_batch3.csv", LanguagePair.of(en, ko));
      expect(meta.nativeLanguages).toEqual(["ko"]);
    });

    it("reverse KO→EN word (vocab) → native is English ['en'] (for English natives)", () => {
      const meta = buildDeckMetadata("beginner_batch3.csv", LanguagePair.of(ko, en));
      expect(meta.templateKind).toBe("word");
      expect(meta.nativeLanguages).toEqual(["en"]);
    });

    it("reverse KO→EN conversation → native stays [ko] (Korean-native production deck)", () => {
      const meta = buildDeckMetadata("real-conversation-시사.csv", LanguagePair.of(ko, en));
      expect(meta.templateKind).toBe("phrase");
      expect(meta.nativeLanguages).toEqual(["ko"]);
    });

    it("forward EN→JA word → native is [ja]", () => {
      const meta = buildDeckMetadata("ielts-7.0-1500.csv", LanguagePair.of(en, ja));
      expect(meta.nativeLanguages).toEqual(["ja"]);
    });
  });

  it("description is non-empty and mentions language direction", () => {
    const meta = buildDeckMetadata(
      "beginner_batch1.csv",
      LanguagePair.of(en, ko),
    );
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.description.toLowerCase()).toMatch(/english|영어/);
  });
});
