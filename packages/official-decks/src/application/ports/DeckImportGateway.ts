import type { ImportPlan, ImportSummary } from "@/application/dto/ImportPlan";

export interface DeckImportGateway {
  /**
   * Idempotently upserts the deck + cards + marketplace listing for one plan.
   * Implementations call the `import_official_deck` SECURITY DEFINER RPC.
   */
  apply(plan: ImportPlan): Promise<ImportSummary>;

  /**
   * Records that a plan failed (for audit). Implementations call
   * `mark_official_deck_failed` RPC.
   */
  markFailed(plan: ImportPlan, error: Error): Promise<void>;

  /**
   * Rewrites an existing official deck's localized name/description (and its
   * marketplace listing title/description) in place, without touching cards,
   * the checksum, or the manifest. Used by the `relocalize` ops command to push
   * regenerated mother-tongue metadata to decks whose card content is unchanged
   * (so a normal `apply` would no-op). Returns true when the deck row existed.
   */
  updateMetadata(
    deckId: string,
    name: string,
    description: string,
  ): Promise<boolean>;
}
