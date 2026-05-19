import { describe, it, expect } from "vitest";
import {
  DeckCategory,
  inferCategoryFromFilename,
  inferLevelFromFilename,
  isDeckCategory,
} from "@/domain/value-objects/DeckCategory";

describe("DeckCategory", () => {
  it("isDeckCategory accepts all valid categories", () => {
    const valid: DeckCategory[] = [
      "beginner",
      "intermediate",
      "advanced",
      "ielts",
      "toefl",
      "toeic",
      "conversation",
      "general",
    ];
    for (const c of valid) {
      expect(isDeckCategory(c)).toBe(true);
    }
    expect(isDeckCategory("unknown")).toBe(false);
  });

  it.each([
    ["beginner_batch1.csv", "beginner"],
    ["beginner_batch10.csv", "beginner"],
    ["intermediate_batch3.csv", "intermediate"],
    ["advanced_batch7.csv", "advanced"],
    ["ielts-5.0-800.csv", "ielts"],
    ["ielts-7.0-1500.csv", "ielts"],
    ["toefl-60-800.csv", "toefl"],
    ["toefl-120-1500.csv", "toefl"],
    ["toeic-600-1000.csv", "toeic"],
    ["toeic-990-1500.csv", "toeic"],
    ["english-beginner-1000.csv", "beginner"],
    ["real-conversation-시사.csv", "conversation"],
    ["real-conversation-여행.csv", "conversation"],
    ["real-conversation-일상.csv", "conversation"],
  ] as const)("inferCategoryFromFilename(%s) === %s", (filename, expected) => {
    expect(inferCategoryFromFilename(filename)).toBe(expected);
  });

  it("falls back to 'general' for unknown filename patterns", () => {
    expect(inferCategoryFromFilename("mystery-file.csv")).toBe("general");
  });

  it.each([
    ["beginner_batch1.csv", "batch-1"],
    ["intermediate_batch10.csv", "batch-10"],
    ["advanced_batch7.csv", "batch-7"],
    ["ielts-5.0-800.csv", "5.0"],
    ["ielts-6.5-1500.csv", "6.5"],
    ["toefl-100-1500.csv", "100"],
    ["toeic-990-1500.csv", "990"],
    ["english-beginner-1000.csv", null],
    ["real-conversation-시사.csv", "시사"],
  ] as const)("inferLevelFromFilename(%s) === %s", (filename, expected) => {
    expect(inferLevelFromFilename(filename)).toBe(expected);
  });
});
