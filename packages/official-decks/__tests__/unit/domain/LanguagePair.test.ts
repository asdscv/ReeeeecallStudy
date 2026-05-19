import { describe, it, expect } from "vitest";
import { parseLanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";

describe("LanguagePair", () => {
  it("constructs with source ≠ target", () => {
    const pair = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));
    expect(pair.source).toBe("en");
    expect(pair.target).toBe("ko");
  });

  it("throws when source === target", () => {
    expect(() =>
      LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("en")),
    ).toThrow(/must differ/i);
  });

  it("serialises to a stable string `en-ko`", () => {
    const pair = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));
    expect(pair.toString()).toBe("en-ko");
  });

  it("parses from `en-ko`", () => {
    const pair = LanguagePair.fromString("en-ko");
    expect(pair.source).toBe("en");
    expect(pair.target).toBe("ko");
  });

  it("fromString rejects malformed input", () => {
    expect(() => LanguagePair.fromString("en")).toThrow();
    expect(() => LanguagePair.fromString("en-en")).toThrow();
    expect(() => LanguagePair.fromString("en-xx")).toThrow();
    expect(() => LanguagePair.fromString("xx-ko")).toThrow();
    expect(() => LanguagePair.fromString("")).toThrow();
  });

  it("equality is value-based", () => {
    const a = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));
    const b = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));
    const c = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ja"));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
