import { UnknownCsvSchemaError } from "@/domain/errors/DomainError";
import type { RawCsv } from "@/application/ports/CsvSource";

/**
 * Three known CSV shapes:
 *
 *   A (batches) — 16 columns, no header. Column order:
 *     en_word, en_ex, ko_word, ko_ex, ja_word, ja_ex, zh_word, zh_ex,
 *     es_word, es_ex, vi_word, vi_ex, th_word, th_ex, id_word, id_ex
 *
 *   B (exam / english-beginner) — 16 columns, with header starting:
 *     english,example,ko_meaning,ko_example,ja_meaning,ja_example,...
 *
 *   C (real-conversation) — 6 columns, with header:
 *     korean,english,alt,situation,note,category
 */
export type CsvSchema = "A" | "B" | "C";

export interface SchemaDetection {
  readonly schema: CsvSchema;
  /** Available target languages this CSV provides translations for. */
  readonly availableTargets: readonly string[];
  /** Source language for the deck pairs derived from this file. */
  readonly source: "en" | "ko";
}

const SCHEMA_AB_TARGETS = ["ko", "ja", "zh", "es", "vi", "th", "id"] as const;
const SCHEMA_C_TARGETS = ["en"] as const;

export function detectSchema(csv: RawCsv): SchemaDetection {
  const { header, rows, filename } = csv;

  // Schema C: explicit header begins with `korean,english,alt,situation`
  if (header && headerMatches(header, ["korean", "english", "alt", "situation"])) {
    return {
      schema: "C",
      availableTargets: [...SCHEMA_C_TARGETS],
      source: "ko",
    };
  }

  // Schema B: header begins with `english,example,ko_meaning,ko_example`
  if (
    header &&
    headerMatches(header, ["english", "example", "ko_meaning", "ko_example"])
  ) {
    return {
      schema: "B",
      availableTargets: [...SCHEMA_AB_TARGETS],
      source: "en",
    };
  }

  // Schema A: 16 columns, no header (or rows are first-row data)
  const sampleRow = header ?? rows[0]?.cells ?? [];
  if (!header && sampleRow.length === 16) {
    return {
      schema: "A",
      availableTargets: [...SCHEMA_AB_TARGETS],
      source: "en",
    };
  }

  throw new UnknownCsvSchemaError(
    filename,
    `header=${header ? header.join(",") : "(none)"}, columns=${sampleRow.length}`,
  );
}

function headerMatches(
  header: readonly string[],
  prefix: readonly string[],
): boolean {
  if (header.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    const got = header[i]?.trim().toLowerCase();
    if (got !== prefix[i]) return false;
  }
  return true;
}
