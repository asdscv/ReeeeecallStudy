import { Checksum } from "@/domain/value-objects/Checksum";
import { parseLanguageCode, type LanguageCode } from "@/domain/value-objects/LanguageCode";
import { LanguagePair } from "@/domain/value-objects/LanguagePair";
import { ManifestKey } from "@/domain/value-objects/ManifestKey";
import { computeCardId, computeDeckId } from "@/domain/services/IdentityService";
import { buildDeckMetadata } from "@/domain/services/DeckMetadataBuilder";
import type { OfficialDeck } from "@/domain/entities/OfficialDeck";
import type { OfficialCard } from "@/domain/entities/OfficialCard";
import type { RawCsv } from "@/application/ports/CsvSource";
import { detectSchema } from "@/application/services/CsvSchemaDetector";
import { parseRow } from "@/application/services/CsvRowParser";
import type { ImportPlan } from "@/application/dto/ImportPlan";
import {
  MalformedCsvRowError,
  MissingRequiredFieldError,
} from "@/domain/errors/DomainError";

export interface BuildOptions {
  /**
   * If true, rows that fail row-level validation are skipped with a warning
   * instead of aborting the whole CSV. Default false (strict).
   */
  readonly skipMalformedRows?: boolean;
  /**
   * Optional sink for parser warnings. Defaults to console.warn.
   */
  readonly onWarning?: (message: string) => void;
}

/**
 * Build all language-pair plans for a single CSV.
 *
 * Returns one plan per (source, target) pair available in the CSV.
 * For schema A/B: 7 plans (en → ko/ja/zh/es/vi/th/id).
 * For schema C : 1 plan (ko → en).
 */
export function buildPlansForCsv(
  csv: RawCsv,
  opts: BuildOptions = {},
): readonly ImportPlan[] {
  const detection = detectSchema(csv);
  const source = parseLanguageCode(detection.source);
  const warn = opts.onWarning ?? ((m: string) => console.warn(m));

  const plans: ImportPlan[] = [];
  for (const targetStr of detection.availableTargets) {
    if (targetStr === detection.source) continue;
    const target = parseLanguageCode(targetStr);
    // Forward direction (e.g. word: en→X, conversation: ko→en).
    plans.push(
      buildSinglePlan(
        csv,
        LanguagePair.of(source, target),
        detection.schema,
        opts.skipMalformedRows ?? false,
        warn,
      ),
    );
    // Reverse direction for word schemas only (A/B): X→en. This yields a
    // native-first, English-voiced deck (template 3333) that pairs with the
    // forward en→X deck so both study directions exist. Conversation decks
    // (schema C) are already native-first and are not reversed.
    if (detection.schema === "A" || detection.schema === "B") {
      plans.push(
        buildSinglePlan(
          csv,
          LanguagePair.of(target, source),
          detection.schema,
          opts.skipMalformedRows ?? false,
          warn,
        ),
      );
    }
  }
  return plans;
}

function buildSinglePlan(
  csv: RawCsv,
  pair: LanguagePair,
  schema: "A" | "B" | "C",
  skipMalformed: boolean,
  warn: (m: string) => void,
): ImportPlan {
  const meta = buildDeckMetadata(csv.filename, pair);
  const manifestKey = ManifestKey.of(csv.filename, pair);
  const deckId = computeDeckId(manifestKey);

  // First: parse & validate every row into card payloads. Skip empty rows.
  const cards: OfficialCard[] = [];
  const canonicalRows: { col: readonly string[] }[] = [];
  let cardCount = 0;

  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i]!;
    if (row.cells.every((c) => c.trim().length === 0)) continue;
    let fieldValues;
    try {
      fieldValues = parseRow(schema, row, csv.filename, i, pair.source, pair.target);
    } catch (e) {
      if (
        skipMalformed &&
        (e instanceof MalformedCsvRowError ||
          e instanceof MissingRequiredFieldError)
      ) {
        warn(`[skip] ${csv.filename} row ${i}: ${(e as Error).message}`);
        continue;
      }
      throw e;
    }
    const cardId = computeCardId(deckId, cardCount);
    cards.push({
      id: cardId,
      sortPosition: cardCount,
      fieldValues,
      tags: [],
    });
    canonicalRows.push({ col: row.cells });
    cardCount++;
  }

  const checksum = Checksum.ofCanonicalRows(canonicalRows).value;

  const deck: OfficialDeck = {
    id: deckId,
    manifestKey,
    name: meta.name,
    description: meta.description,
    color: meta.color,
    icon: meta.icon,
    category: meta.category,
    tags: meta.tags,
    languagePair: pair,
    learningLanguage: meta.learningLanguage,
    nativeLanguages: meta.nativeLanguages,
    sourceFile: csv.filename,
    templateId: meta.templateId,
    cards,
  };

  return { deck, checksum };
}

/**
 * Convenience: build plans for many CSVs and return a flat list.
 */
export function buildAllPlans(
  csvs: readonly RawCsv[],
  opts: BuildOptions = {},
): readonly ImportPlan[] {
  return csvs.flatMap((csv) => buildPlansForCsv(csv, opts));
}

/**
 * Filter languages exposed for a given CSV. Used by the CLI to e.g. exclude
 * a target language for one batch run. The plan builder calls this through
 * `availableTargets` — callers wanting partial output should call
 * `buildPlansForCsv` and post-filter the returned array.
 */
export type LanguageFilter = (pair: LanguagePair) => boolean;

export function filterPlans(
  plans: readonly ImportPlan[],
  predicate: LanguageFilter,
): readonly ImportPlan[] {
  return plans.filter((p) => predicate(p.deck.languagePair));
}

// Re-export for convenience
export type { LanguageCode };
