// Port for reading raw CSV row data. Implementations live in
// infrastructure/csv. The application layer talks only to this port.

export interface RawCsvRow {
  readonly cells: readonly string[];
}

export interface RawCsv {
  readonly filename: string;
  readonly header: readonly string[] | null;
  readonly rows: readonly RawCsvRow[];
}

export interface CsvSource {
  /** Returns the raw rows for a single CSV file by basename. */
  read(filename: string): Promise<RawCsv>;
  /** Returns the list of CSV basenames available in the source. */
  list(): Promise<readonly string[]>;
}
