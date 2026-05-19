import type { OfficialDeck } from "@/domain/entities/OfficialDeck";

export interface ImportPlan {
  readonly deck: OfficialDeck;
  readonly checksum: string;
}

export interface ImportSummary {
  readonly manifestKey: string;
  readonly deckId: string;
  readonly status: "applied" | "noop" | "failed";
  readonly cardsInserted: number;
  readonly cardsUpdated: number;
  readonly cardsDeleted: number;
  readonly cardCount: number;
  readonly error?: string;
  readonly durationMs: number;
}

export interface ImportReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly totalPlans: number;
  readonly summaries: readonly ImportSummary[];
  readonly applied: number;
  readonly noop: number;
  readonly failed: number;
}
