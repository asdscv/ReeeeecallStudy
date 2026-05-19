import { describe, it, expect } from "vitest";
import {
  LanguageCode,
  SUPPORTED_LANGUAGES,
  isLanguageCode,
  parseLanguageCode,
} from "@/domain/value-objects/LanguageCode";

describe("LanguageCode", () => {
  it("accepts all 8 supported language codes", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual([
      "en",
      "ko",
      "ja",
      "zh",
      "es",
      "vi",
      "th",
      "id",
    ]);
  });

  it("isLanguageCode narrows valid strings", () => {
    expect(isLanguageCode("en")).toBe(true);
    expect(isLanguageCode("ko")).toBe(true);
    expect(isLanguageCode("zh")).toBe(true);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode("")).toBe(false);
    expect(isLanguageCode("EN")).toBe(false);
  });

  it("parseLanguageCode returns brand for valid input", () => {
    const code: LanguageCode = parseLanguageCode("en");
    expect(code).toBe("en");
  });

  it("parseLanguageCode throws for invalid input", () => {
    expect(() => parseLanguageCode("xx")).toThrow(/unsupported language/i);
    expect(() => parseLanguageCode("")).toThrow(/unsupported language/i);
  });
});
