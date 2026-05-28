import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeckImportGateway } from "@/application/ports/DeckImportGateway";
import type { ImportPlan, ImportSummary } from "@/application/dto/ImportPlan";
import type { OfficialCard } from "@/domain/entities/OfficialCard";

export class SupabaseDeckImportGateway implements DeckImportGateway {
  constructor(private readonly client: SupabaseClient) {}

  async apply(plan: ImportPlan): Promise<ImportSummary> {
    const { deck } = plan;
    const payload = {
      p_manifest_key: deck.manifestKey.toString(),
      p_checksum: plan.checksum,
      p_deck: {
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
        learning_language: deck.learningLanguage,
        native_languages: deck.nativeLanguages,
      },
      p_cards: deck.cards.map(toCardPayload),
    };

    const { data, error } = await this.client.rpc(
      "import_official_deck",
      payload,
    );

    if (error) {
      throw new Error(
        `import_official_deck RPC failed for ${deck.manifestKey.toString()}: ${error.message}`,
      );
    }

    if (!data || typeof data !== "object") {
      throw new Error(
        `import_official_deck returned unexpected payload: ${JSON.stringify(data)}`,
      );
    }

    const d = data as {
      deck_id?: string;
      status?: "applied" | "noop";
      cards_inserted?: number;
      cards_updated?: number;
      cards_deleted?: number;
      card_count?: number;
    };

    return {
      manifestKey: deck.manifestKey.toString(),
      deckId: d.deck_id ?? deck.id,
      status: d.status ?? "applied",
      cardsInserted: d.cards_inserted ?? 0,
      cardsUpdated: d.cards_updated ?? 0,
      cardsDeleted: d.cards_deleted ?? 0,
      cardCount: d.card_count ?? deck.cards.length,
      durationMs: 0,
    };
  }

  async updateMetadata(
    deckId: string,
    name: string,
    description: string,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("decks")
      .update({ name, description })
      .eq("id", deckId)
      .select("id");
    if (error) {
      throw new Error(`update decks failed for ${deckId}: ${error.message}`);
    }
    // Mirror to the marketplace listing (title = deck name). A missing listing
    // is a no-op (some official decks may not be listed).
    const { error: listingError } = await this.client
      .from("marketplace_listings")
      .update({ title: name, description })
      .eq("deck_id", deckId);
    if (listingError) {
      throw new Error(
        `update marketplace_listings failed for ${deckId}: ${listingError.message}`,
      );
    }
    return Array.isArray(data) && data.length > 0;
  }

  async markFailed(plan: ImportPlan, error: Error): Promise<void> {
    const { deck } = plan;
    const { error: rpcError } = await this.client.rpc(
      "mark_official_deck_failed",
      {
        p_manifest_key: deck.manifestKey.toString(),
        p_source_file: deck.sourceFile,
        p_source_language: deck.languagePair.source,
        p_target_language: deck.languagePair.target,
        p_category: deck.category,
        p_error: truncate(error.message, 2000),
      },
    );
    if (rpcError) {
      throw new Error(
        `mark_official_deck_failed RPC failed for ${deck.manifestKey.toString()}: ${rpcError.message}`,
      );
    }
  }
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
