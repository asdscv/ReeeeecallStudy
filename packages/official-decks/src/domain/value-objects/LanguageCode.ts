// LanguageCode — branded type for ISO-639-style 2-letter codes we support.
// Source of truth: the columns present in STUDY_DATA CSVs.

export const SUPPORTED_LANGUAGES = [
  "en",
  "ko",
  "ja",
  "zh",
  "es",
  "vi",
  "th",
  "id",
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_SET: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGE_SET.has(value);
}

export function parseLanguageCode(value: string): LanguageCode {
  if (!isLanguageCode(value)) {
    throw new Error(
      `unsupported language code: ${JSON.stringify(value)} (expected one of ${[...SUPPORTED_LANGUAGES].join(", ")})`,
    );
  }
  return value;
}
