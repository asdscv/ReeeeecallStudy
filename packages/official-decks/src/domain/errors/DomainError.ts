// Typed error hierarchy for the official-decks domain.
// Each error class carries a stable `code` so callers (CLI / CI) can branch.

export type DomainErrorCode =
  | "UNSUPPORTED_LANGUAGE"
  | "INVALID_LANGUAGE_PAIR"
  | "INVALID_FILENAME"
  | "UNKNOWN_CSV_SCHEMA"
  | "MALFORMED_CSV_ROW"
  | "EMPTY_CSV"
  | "MISSING_REQUIRED_FIELD"
  | "DUPLICATE_MANIFEST_KEY";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

export class MalformedCsvRowError extends DomainError {
  constructor(filename: string, rowIndex: number, reason: string) {
    super("MALFORMED_CSV_ROW", `${filename}:${rowIndex} — ${reason}`, {
      filename,
      rowIndex,
    });
    this.name = "MalformedCsvRowError";
  }
}

export class UnknownCsvSchemaError extends DomainError {
  constructor(filename: string, hint?: string) {
    super(
      "UNKNOWN_CSV_SCHEMA",
      `unknown CSV schema for ${filename}${hint ? ` — ${hint}` : ""}`,
      { filename },
    );
    this.name = "UnknownCsvSchemaError";
  }
}

export class MissingRequiredFieldError extends DomainError {
  constructor(filename: string, rowIndex: number, field: string) {
    super(
      "MISSING_REQUIRED_FIELD",
      `${filename}:${rowIndex} — missing required field "${field}"`,
      { filename, rowIndex, field },
    );
    this.name = "MissingRequiredFieldError";
  }
}
