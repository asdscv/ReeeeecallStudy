import { createHash } from "node:crypto";

const CELL_SEPARATOR = ""; // Unit Separator — won't appear in CSV cells
const ROW_SEPARATOR = ""; // Record Separator — won't appear in CSV cells

export interface CanonicalRow {
  /** Cells in the row, left-to-right. */
  col: readonly string[];
}

export class Checksum {
  private constructor(public readonly value: string) {}

  static ofString(input: string): Checksum {
    const hex = createHash("sha256").update(input, "utf8").digest("hex");
    return new Checksum(hex);
  }

  /**
   * Canonicalises the row set before hashing so that benign reorders and
   * trailing whitespace differences do not produce a different checksum.
   * Blank rows (every cell empty after trim) are dropped.
   */
  static ofCanonicalRows(rows: readonly CanonicalRow[]): Checksum {
    const cleaned: string[] = [];
    for (const row of rows) {
      const trimmed = row.col.map((cell) => cell.trim());
      const isBlank = trimmed.every((cell) => cell.length === 0);
      if (isBlank) continue;
      cleaned.push(trimmed.join(CELL_SEPARATOR));
    }
    cleaned.sort();
    return Checksum.ofString(cleaned.join(ROW_SEPARATOR));
  }

  equals(other: Checksum): boolean {
    return this.value === other.value;
  }
}
