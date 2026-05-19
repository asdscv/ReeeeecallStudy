import { readFile, readdir } from "node:fs/promises";
import { extname, basename, join } from "node:path";
import Papa from "papaparse";
import type { CsvSource, RawCsv } from "@/application/ports/CsvSource";

export interface PapaCsvSourceOptions {
  /** Absolute path to the directory containing CSV files. */
  readonly directory: string;
  /** Files to exclude from `list()` results. Default: ['chinese-pronunciation.csv']. */
  readonly excludeFilenames?: readonly string[];
  /** If true, the first non-empty row is treated as header when it parses as a header. Default true. */
  readonly autoDetectHeader?: boolean;
  /**
   * "quoted"    — RFC 4180 strict CSV (use Papa's default quote handling).
   * "unquoted"  — treat `"` as literal data; `,` is the only separator.
   * "auto"      — try `quoted` first; if it yields lots of malformed rows for
   *               a 16-column expectation, retry with `unquoted`. Default.
   *
   * The STUDY_DATA corpus contains files whose generator mishandled quoting,
   * leaving malformed `"..."""` runs that confuse RFC 4180 parsers. For those
   * we have to fall back to comma-only parsing.
   */
  readonly parseMode?: "quoted" | "unquoted" | "auto";
}

const DEFAULT_EXCLUDES = ["chinese-pronunciation.csv"] as const;

export class PapaCsvSource implements CsvSource {
  private readonly excludes: ReadonlySet<string>;
  private readonly autoDetectHeader: boolean;
  private readonly parseMode: "quoted" | "unquoted" | "auto";

  constructor(private readonly opts: PapaCsvSourceOptions) {
    this.excludes = new Set(opts.excludeFilenames ?? DEFAULT_EXCLUDES);
    this.autoDetectHeader = opts.autoDetectHeader ?? true;
    this.parseMode = opts.parseMode ?? "auto";
  }

  async list(): Promise<readonly string[]> {
    const entries = await readdir(this.opts.directory, { withFileTypes: true });
    const csvs: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (extname(name).toLowerCase() !== ".csv") continue;
      if (this.excludes.has(name)) continue;
      // also skip sidecar files like *.csv.checkpoint
      if (!name.endsWith(".csv") || name.includes(".csv.")) continue;
      csvs.push(name);
    }
    csvs.sort();
    return csvs;
  }

  async read(filename: string): Promise<RawCsv> {
    const path = join(this.opts.directory, filename);
    const content = await readFile(path, "utf8");
    return this.parse(filename, content);
  }

  parse(filename: string, content: string): RawCsv {
    // Strip UTF-8 BOM if present
    const cleaned = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

    let rows: string[][];
    if (this.parseMode === "auto") {
      rows = this.parseAuto(cleaned);
    } else if (this.parseMode === "unquoted") {
      rows = this.parseOnce(cleaned, "unquoted");
    } else {
      rows = this.parseOnce(cleaned, "quoted");
    }

    let header: readonly string[] | null = null;
    if (this.autoDetectHeader && rows.length > 0) {
      const first = rows[0]!;
      if (looksLikeHeader(first)) {
        header = first;
        rows.shift();
      }
    }

    return {
      filename: basename(filename),
      header,
      rows: rows.map((r) => ({ cells: r })),
    };
  }

  private parseOnce(content: string, mode: "quoted" | "unquoted"): string[][] {
    const config: Papa.ParseConfig<string[]> = {
      skipEmptyLines: "greedy",
      transform: (v) => v ?? "",
    };
    if (mode === "unquoted") {
      // Treat `"` as literal data; only `,` is a separator.
      // Papa accepts a null character to mean "no quote handling".
      config.quoteChar = "\0";
    }
    const result = Papa.parse<string[]>(content, config);
    return (result.data as string[][]).filter(
      (r) => Array.isArray(r) && r.length > 0,
    );
  }

  /**
   * Try strict CSV first. If the result has many rows whose column count
   * deviates from the modal width (signalling malformed-quote corruption),
   * re-parse with quote-free mode.
   */
  private parseAuto(content: string): string[][] {
    const quoted = this.parseOnce(content, "quoted");
    const modeWidth = modeColumnWidth(quoted);
    const quotedBad = countBadRows(quoted, modeWidth);

    // If fewer than 5 rows or <1% deviate, prefer quoted (RFC-correct).
    const threshold = Math.max(5, Math.floor(quoted.length * 0.01));
    if (quotedBad <= threshold) return quoted;

    const unquoted = this.parseOnce(content, "unquoted");
    const unquotedMode = modeColumnWidth(unquoted);
    const unquotedBad = countBadRows(unquoted, unquotedMode);
    return unquotedBad < quotedBad ? unquoted : quoted;
  }
}

function modeColumnWidth(rows: readonly string[][]): number {
  const tally = new Map<number, number>();
  for (const r of rows) tally.set(r.length, (tally.get(r.length) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [w, c] of tally) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

function countBadRows(rows: readonly string[][], expected: number): number {
  let bad = 0;
  for (const r of rows) if (r.length !== expected) bad++;
  return bad;
}

function looksLikeHeader(row: readonly string[]): boolean {
  // Header detection: every non-empty cell is purely lowercase ASCII with
  // underscores/letters (matching `english,example,ko_meaning,...` and
  // `korean,english,alt,situation,...`). Real data rows almost always have
  // CJK chars, capitalised words, sentence punctuation, or digits.
  let nonEmpty = 0;
  for (const cell of row) {
    const trimmed = cell.trim();
    if (trimmed.length === 0) continue;
    nonEmpty++;
    if (!/^[a-z][a-z_]*$/.test(trimmed)) return false;
  }
  return nonEmpty >= 2;
}
