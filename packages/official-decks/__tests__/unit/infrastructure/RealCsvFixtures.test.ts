import { describe, it, expect, beforeAll } from "vitest";
import { PapaCsvSource } from "@/infrastructure/csv/PapaCsvSource";
import { detectSchema } from "@/application/services/CsvSchemaDetector";
import { buildPlansForCsv } from "@/application/services/ImportPlanBuilder";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const STUDY_DATA_PATHS = [
  process.env.STUDY_DATA_DIR,
  resolve(__dirname, "../../../../../../STUDY_DATA"),
  resolve(__dirname, "../../../../../STUDY_DATA"),
  resolve(__dirname, "../../../../STUDY_DATA"),
  resolve(__dirname, "../../../STUDY_DATA"),
].filter((p): p is string => typeof p === "string" && p.length > 0);
const STUDY_DATA = STUDY_DATA_PATHS.find((p) => existsSync(p));

describe.skipIf(!STUDY_DATA)("Real STUDY_DATA fixtures", () => {
  let source: PapaCsvSource;
  let csvList: readonly string[];

  beforeAll(async () => {
    source = new PapaCsvSource({ directory: STUDY_DATA! });
    csvList = await source.list();
  });

  it("lists exactly 51 CSVs (excluding chinese-pronunciation + sidecars)", () => {
    expect(csvList.length).toBe(51);
    expect(csvList).not.toContain("chinese-pronunciation.csv");
  });

  it("every CSV parses and is recognised by the schema detector", async () => {
    for (const name of csvList) {
      const csv = await source.read(name);
      const det = detectSchema(csv);
      expect(["A", "B", "C"]).toContain(det.schema);
    }
  });

  it("total plan count across all CSVs equals 649 (322 forward + 322 reverse word + 5 conversation)", async () => {
    let total = 0;
    for (const name of csvList) {
      const csv = await source.read(name);
      const plans = buildPlansForCsv(csv, { skipMalformedRows: true });
      total += plans.length;
    }
    expect(total).toBe(649);
  });

  it("beginner_batch1.csv produces 14 plans (forward + reverse), each with cards", async () => {
    const csv = await source.read("beginner_batch1.csv");
    const plans = buildPlansForCsv(csv, { skipMalformedRows: true });
    expect(plans).toHaveLength(14);
    for (const plan of plans) {
      expect(plan.deck.cards.length).toBeGreaterThan(0);
    }
  });

  it("real-conversation-시사.csv produces 1 plan (ko→en)", async () => {
    const csv = await source.read("real-conversation-시사.csv");
    const plans = buildPlansForCsv(csv, { skipMalformedRows: true });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.deck.languagePair.source).toBe("ko");
    expect(plans[0]!.deck.languagePair.target).toBe("en");
  });
});
