import type { Client, Pool } from "pg";
import type { DeckImportGateway } from "@/application/ports/DeckImportGateway";
import type { ImportPlan, ImportSummary } from "@/application/dto/ImportPlan";
import type { OfficialCard } from "@/domain/entities/OfficialCard";

export interface PgConnectable {
  query: Client["query"] | Pool["query"];
}

/**
 * Direct PostgreSQL gateway — calls the same SECURITY DEFINER RPCs via SQL
 * `SELECT import_official_deck(...)` rather than PostgREST HTTP.
 *
 * Used by integration tests against a plain postgres container, and as the
 * production path when running the CLI with `PG_URL` set instead of
 * `SUPABASE_URL` (e.g. inside a private network without PostgREST).
 */
export class PgDeckImportGateway implements DeckImportGateway {
  constructor(private readonly db: PgConnectable) {}

  async apply(plan: ImportPlan): Promise<ImportSummary> {
    const { deck } = plan;
    const deckPayload = {
      name: deck.name,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
      template_id: deck.templateId,
      category: deck.category,
      tags: deck.tags,
      source_file: deck.sourceFile,
      source_language: deck.languagePair.source,
      target_language: deck.languagePair.target,
    };
    const cardsPayload = deck.cards.map(toCardPayload);
    const result = await this.db.query<
      { import_official_deck: ImportResult }
    >(
      `SELECT import_official_deck($1, $2, $3::jsonb, $4::jsonb) AS import_official_deck`,
      [
        deck.manifestKey.toString(),
        plan.checksum,
        JSON.stringify(deckPayload),
        JSON.stringify(cardsPayload),
      ],
    );
    const data = result.rows[0]?.import_official_deck;
    if (!data) {
      throw new Error(
        `import_official_deck returned no rows for ${deck.manifestKey.toString()}`,
      );
    }
    return {
      manifestKey: deck.manifestKey.toString(),
      deckId: data.deck_id ?? deck.id,
      status: data.status ?? "applied",
      cardsInserted: data.cards_inserted ?? 0,
      cardsUpdated: data.cards_updated ?? 0,
      cardsDeleted: data.cards_deleted ?? 0,
      cardCount: data.card_count ?? deck.cards.length,
      durationMs: 0,
    };
  }

  async markFailed(plan: ImportPlan, error: Error): Promise<void> {
    const { deck } = plan;
    await this.db.query(
      `SELECT mark_official_deck_failed($1, $2, $3, $4, $5, $6)`,
      [
        deck.manifestKey.toString(),
        deck.sourceFile,
        deck.languagePair.source,
        deck.languagePair.target,
        deck.category,
        truncate(error.message, 2000),
      ],
    );
  }
}

interface ImportResult {
  deck_id?: string;
  listing_id?: string;
  status?: "applied" | "noop";
  cards_inserted?: number;
  cards_updated?: number;
  cards_deleted?: number;
  card_count?: number;
}

function toCardPayload(card: OfficialCard) {
  return {
    id: card.id,
    sort_position: card.sortPosition,
    field_values: card.fieldValues,
    tags: card.tags,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
