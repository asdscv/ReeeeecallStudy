import {
  MalformedCsvRowError,
  MissingRequiredFieldError,
} from "@/domain/errors/DomainError";
import type { LanguageCode } from "@/domain/value-objects/LanguageCode";
import type { CardFieldValues } from "@/domain/value-objects/CardFieldValues";
import type { RawCsvRow } from "@/application/ports/CsvSource";
import type { CsvSchema } from "@/application/services/CsvSchemaDetector";

/**
 * Column index of (word, example) in schemas A and B for a given target lang.
 * Source (en) is always at indices 0,1.
 */
const SCHEMA_AB_COLUMNS: Record<LanguageCode, [number, number]> = {
  en: [0, 1],
  ko: [2, 3],
  ja: [4, 5],
  zh: [6, 7],
  es: [8, 9],
  vi: [10, 11],
  th: [12, 13],
  id: [14, 15],
};

/**
 * Schema C columns:
 *   0: korean (source)
 *   1: english (target, primary)
 *   2: alt (alternate phrasing)
 *   3: situation
 *   4: note
 *   5: category (ignored — derived from filename instead)
 */

export function parseWordCardFromAB(
  row: RawCsvRow,
  filename: string,
  rowIndex: number,
  source: LanguageCode,
  target: LanguageCode,
): CardFieldValues {
  const cells = row.cells;
  const expected = 16;
  if (cells.length < expected) {
    throw new MalformedCsvRowError(
      filename,
      rowIndex,
      `expected ${expected} columns, got ${cells.length}`,
    );
  }

  const [srcWordIdx, srcExIdx] = SCHEMA_AB_COLUMNS[source];
  const [tgtWordIdx, tgtExIdx] = SCHEMA_AB_COLUMNS[target];

  const front = cells[srcWordIdx]?.trim() ?? "";
  const back = cells[tgtWordIdx]?.trim() ?? "";
  const exampleFront = cells[srcExIdx]?.trim() ?? "";
  const exampleBack = cells[tgtExIdx]?.trim() ?? "";

  if (front.length === 0) {
    throw new MissingRequiredFieldError(filename, rowIndex, `${source}_word`);
  }
  if (back.length === 0) {
    throw new MissingRequiredFieldError(filename, rowIndex, `${target}_word`);
  }

  return {
    kind: "word",
    front,
    back,
    example_front: exampleFront,
    example_back: exampleBack,
  };
}

export function parsePhraseCardFromC(
  row: RawCsvRow,
  filename: string,
  rowIndex: number,
): CardFieldValues {
  const cells = row.cells;
  if (cells.length < 5) {
    throw new MalformedCsvRowError(
      filename,
      rowIndex,
      `expected 5+ columns, got ${cells.length}`,
    );
  }
  const front = cells[0]?.trim() ?? "";
  const back = cells[1]?.trim() ?? "";
  const alt = cells[2]?.trim() ?? "";
  const situation = cells[3]?.trim() ?? "";
  const note = cells[4]?.trim() ?? "";

  if (front.length === 0) {
    throw new MissingRequiredFieldError(filename, rowIndex, "korean");
  }
  if (back.length === 0) {
    throw new MissingRequiredFieldError(filename, rowIndex, "english");
  }

  return { kind: "phrase", front, back, alt, situation, note };
}

export function parseRow(
  schema: CsvSchema,
  row: RawCsvRow,
  filename: string,
  rowIndex: number,
  source: LanguageCode,
  target: LanguageCode,
): CardFieldValues {
  switch (schema) {
    case "A":
    case "B":
      return parseWordCardFromAB(row, filename, rowIndex, source, target);
    case "C":
      return parsePhraseCardFromC(row, filename, rowIndex);
  }
}
