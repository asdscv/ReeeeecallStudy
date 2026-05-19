import { describe, it, expect } from "vitest";
import { detectSchema } from "@/application/services/CsvSchemaDetector";
import type { RawCsv } from "@/application/ports/CsvSource";

const headerB = [
  "english", "example", "ko_meaning", "ko_example",
  "ja_meaning", "ja_example", "zh_meaning", "zh_example",
  "es_meaning", "es_example", "vi_meaning", "vi_example",
  "th_meaning", "th_example", "id_meaning", "id_example",
];
const headerC = ["korean", "english", "alt", "situation", "note", "category"];

describe("CsvSchemaDetector", () => {
  it("detects schema A by absence of header + 16 columns", () => {
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [{ cells: new Array(16).fill("x") }],
    };
    const result = detectSchema(csv);
    expect(result.schema).toBe("A");
    expect(result.source).toBe("en");
    expect(result.availableTargets).toEqual([
      "ko", "ja", "zh", "es", "vi", "th", "id",
    ]);
  });

  it("detects schema B by header prefix `english,example,ko_meaning,...`", () => {
    const csv: RawCsv = {
      filename: "toefl-100-1500.csv",
      header: headerB,
      rows: [],
    };
    const result = detectSchema(csv);
    expect(result.schema).toBe("B");
    expect(result.source).toBe("en");
    expect(result.availableTargets).toContain("ko");
    expect(result.availableTargets).toContain("zh");
  });

  it("detects schema C by header `korean,english,alt,situation,...`", () => {
    const csv: RawCsv = {
      filename: "real-conversation-시사.csv",
      header: headerC,
      rows: [],
    };
    const result = detectSchema(csv);
    expect(result.schema).toBe("C");
    expect(result.source).toBe("ko");
    expect(result.availableTargets).toEqual(["en"]);
  });

  it("throws UnknownCsvSchemaError for unknown shapes", () => {
    const csv: RawCsv = {
      filename: "mystery.csv",
      header: ["foo", "bar", "baz"],
      rows: [],
    };
    expect(() => detectSchema(csv)).toThrow(/unknown csv schema/i);
  });

  it("throws when schema A row has wrong column count", () => {
    const csv: RawCsv = {
      filename: "mystery.csv",
      header: null,
      rows: [{ cells: ["a", "b", "c"] }],
    };
    expect(() => detectSchema(csv)).toThrow(/unknown csv schema/i);
  });
});
