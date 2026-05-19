import { describe, it, expect } from "vitest";
import { parseLanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";
import { ManifestKey } from "@/domain/value-objects/ManifestKey";

describe("ManifestKey", () => {
  const pair = LanguagePair.of(parseLanguageCode("en"), parseLanguageCode("ko"));

  it("formats as csv:{filename-stem}:{lang-pair}", () => {
    const key = ManifestKey.of("beginner_batch1.csv", pair);
    expect(key.toString()).toBe("csv:beginner_batch1:en-ko");
  });

  it("rejects filenames whose terminal extension is not .csv", () => {
    // `foo.csv.bak` ends in `.bak`, not `.csv`. We treat the last extension
    // as authoritative — a sidecar or backup file is not a valid source.
    expect(() => ManifestKey.of("foo.csv.bak", pair)).toThrow(/not a csv/i);
  });

  it("rejects filenames without .csv", () => {
    expect(() => ManifestKey.of("beginner_batch1.txt", pair)).toThrow(
      /not a csv/i,
    );
  });

  it("rejects empty / path-containing filenames", () => {
    expect(() => ManifestKey.of("", pair)).toThrow();
    expect(() => ManifestKey.of("dir/foo.csv", pair)).toThrow(/basename/i);
    expect(() => ManifestKey.of("../foo.csv", pair)).toThrow(/basename/i);
  });

  it("equality is value-based", () => {
    const a = ManifestKey.of("beginner_batch1.csv", pair);
    const b = ManifestKey.of("beginner_batch1.csv", pair);
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe(b.toString());
  });

  it("Korean filename preserves unicode", () => {
    const koSrc = LanguagePair.of(parseLanguageCode("ko"), parseLanguageCode("en"));
    const key = ManifestKey.of("real-conversation-시사.csv", koSrc);
    expect(key.toString()).toBe("csv:real-conversation-시사:ko-en");
  });
});
