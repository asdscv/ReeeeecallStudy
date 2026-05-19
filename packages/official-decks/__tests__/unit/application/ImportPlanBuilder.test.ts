import { describe, it, expect } from "vitest";
import { buildPlansForCsv } from "@/application/services/ImportPlanBuilder";
import type { RawCsv } from "@/application/ports/CsvSource";

function makeSchemaARow(): { cells: string[] } {
  return {
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
}

describe("ImportPlanBuilder.buildPlansForCsv", () => {
  it("schema A CSV → 7 plans (en → ko/ja/zh/es/vi/th/id)", () => {
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow()],
    };
    const plans = buildPlansForCsv(csv);
    expect(plans).toHaveLength(7);
    const targets = plans.map((p) => p.deck.languagePair.target).sort();
    expect(targets).toEqual(["es", "id", "ja", "ko", "th", "vi", "zh"]);
    for (const plan of plans) {
      expect(plan.deck.languagePair.source).toBe("en");
      expect(plan.deck.cards).toHaveLength(1);
      expect(plan.deck.id).toMatch(/^[0-9a-f-]+$/);
      expect(plan.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("schema C CSV → 1 plan (ko → en)", () => {
    const csv: RawCsv = {
      filename: "real-conversation-시사.csv",
      header: ["korean", "english", "alt", "situation", "note", "category"],
      rows: [
        {
          cells: [
            "요즘 물가가 미쳤어",
            "Prices are insane these days.",
            "alt",
            "물가",
            "note",
            "시사",
          ],
        },
      ],
    };
    const plans = buildPlansForCsv(csv);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.deck.languagePair.source).toBe("ko");
    expect(plans[0]!.deck.languagePair.target).toBe("en");
    expect(plans[0]!.deck.category).toBe("conversation");
    expect(plans[0]!.deck.templateId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("checksum is stable across re-builds for identical input", () => {
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow(), makeSchemaARow()],
    };
    const a = buildPlansForCsv(csv);
    const b = buildPlansForCsv(csv);
    expect(a.map((p) => p.checksum)).toEqual(b.map((p) => p.checksum));
  });

  it("deck IDs are deterministic across rebuilds", () => {
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow()],
    };
    const a = buildPlansForCsv(csv);
    const b = buildPlansForCsv(csv);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.deck.id).toBe(b[i]!.deck.id);
    }
  });

  it("skips blank rows transparently", () => {
    const blank = { cells: new Array(16).fill("") };
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow(), blank, makeSchemaARow()],
    };
    const plans = buildPlansForCsv(csv);
    expect(plans[0]!.deck.cards).toHaveLength(2);
  });

  it("strict mode throws on malformed row", () => {
    const badRow = { cells: ["", "", ...new Array(14).fill("x")] };
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [badRow],
    };
    expect(() => buildPlansForCsv(csv)).toThrow();
  });

  it("skipMalformedRows mode collects warnings and continues", () => {
    const badRow = { cells: ["", "", ...new Array(14).fill("x")] };
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow(), badRow, makeSchemaARow()],
    };
    const warnings: string[] = [];
    const plans = buildPlansForCsv(csv, {
      skipMalformedRows: true,
      onWarning: (m) => warnings.push(m),
    });
    expect(plans[0]!.deck.cards).toHaveLength(2);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("card IDs are unique within a deck", () => {
    const csv: RawCsv = {
      filename: "beginner_batch1.csv",
      header: null,
      rows: [makeSchemaARow(), makeSchemaARow(), makeSchemaARow()],
    };
    const [plan] = buildPlansForCsv(csv);
    const ids = new Set(plan!.deck.cards.map((c) => c.id));
    expect(ids.size).toBe(3);
  });
});
