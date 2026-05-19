import { describe, it, expect } from "vitest";
import { parseRow } from "@/application/services/CsvRowParser";

const fullABRow = {
  cells: [
    "scarf", "She wore a warm scarf in winter.",
    "스카프", "그녀는 겨울에 따뜻한 스카프를 했어요.",
    "マフラー", "彼女は冬に暖かいマフラーをした。",
    "围巾", "她冬天围了一条暖和的围巾。",
    "bufanda", "Ella usó una bufanda cálida en invierno.",
    "khăn quàng cổ", "Cô ấy quàng khăn ấm vào mùa đông.",
    "ผ้าพันคอ", "เธอสวมผ้าพันคออุ่น ๆ ในฤดูหนาว",
    "syal", "Dia memakai syal hangat di musim dingin.",
  ],
};

describe("CsvRowParser", () => {
  it("schema A: en→ko word card", () => {
    const result = parseRow("A", fullABRow, "beginner_batch1.csv", 0, "en", "ko");
    expect(result.kind).toBe("word");
    if (result.kind === "word") {
      expect(result.front).toBe("scarf");
      expect(result.back).toBe("스카프");
      expect(result.example_front).toContain("scarf");
      expect(result.example_back).toContain("스카프");
    }
  });

  it("schema A: en→zh word card pulls Chinese column", () => {
    const result = parseRow("A", fullABRow, "beginner_batch1.csv", 0, "en", "zh");
    if (result.kind === "word") {
      expect(result.back).toBe("围巾");
      expect(result.example_back).toContain("围巾");
    }
  });

  it("schema A: en→th supports CJK & Thai", () => {
    const result = parseRow("A", fullABRow, "beginner_batch1.csv", 0, "en", "th");
    if (result.kind === "word") {
      expect(result.back).toBe("ผ้าพันคอ");
    }
  });

  it("schema A throws on too few columns", () => {
    expect(() =>
      parseRow("A", { cells: ["a", "b"] }, "x.csv", 0, "en", "ko"),
    ).toThrow(/expected 16 columns/i);
  });

  it("schema A throws on missing source word", () => {
    const empty = { cells: ["", "ex", ...new Array(14).fill("x")] };
    expect(() => parseRow("A", empty, "x.csv", 0, "en", "ko")).toThrow(
      /missing required field "en_word"/i,
    );
  });

  it("schema A throws on missing target word", () => {
    const empty = {
      cells: ["scarf", "ex", "", "", ...new Array(12).fill("x")],
    };
    expect(() => parseRow("A", empty, "x.csv", 0, "en", "ko")).toThrow(
      /missing required field "ko_word"/i,
    );
  });

  it("schema B parses with same column logic as A", () => {
    const result = parseRow("B", fullABRow, "toefl.csv", 0, "en", "ja");
    if (result.kind === "word") {
      expect(result.back).toBe("マフラー");
    }
  });

  it("schema C parses Korean → English phrase card", () => {
    const cRow = {
      cells: [
        "요즘 물가가 미쳤어",
        "Prices are insane these days.",
        "Everything's so pricey now.",
        "물가",
        "cost of living = 생활비",
        "시사",
      ],
    };
    const result = parseRow("C", cRow, "real-conversation-시사.csv", 0, "ko", "en");
    expect(result.kind).toBe("phrase");
    if (result.kind === "phrase") {
      expect(result.front).toBe("요즘 물가가 미쳤어");
      expect(result.back).toContain("Prices are insane");
      expect(result.alt).toContain("Everything");
      expect(result.situation).toBe("물가");
      expect(result.note).toContain("cost of living");
    }
  });

  it("schema C throws on missing required fields", () => {
    const cRow = {
      cells: ["", "english target", "alt", "situation", "note", "cat"],
    };
    expect(() => parseRow("C", cRow, "x.csv", 0, "ko", "en")).toThrow(
      /missing required field "korean"/i,
    );
  });
});
