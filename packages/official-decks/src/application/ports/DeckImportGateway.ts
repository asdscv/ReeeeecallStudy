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
}
