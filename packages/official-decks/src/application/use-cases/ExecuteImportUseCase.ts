import type { ImportPlan, ImportReport, ImportSummary } from "@/application/dto/ImportPlan";
import type { DeckImportGateway } from "@/application/ports/DeckImportGateway";

export interface ExecuteImportOptions {
  /**
   * Maximum number of concurrent plan executions. Default 4.
   * The Supabase RPC is a single transaction per call, so the effective
   * concurrency limit is the database's connection pool, typically 60.
   * We stay conservative.
   */
  readonly concurrency?: number;
  /** Called as each plan completes (for progress reporting). */
  readonly onProgress?: (summary: ImportSummary, doneCount: number, total: number) => void;
}

export class ExecuteImportUseCase {
  constructor(private readonly gateway: DeckImportGateway) {}

  async execute(
    plans: readonly ImportPlan[],
    options: ExecuteImportOptions = {},
  ): Promise<ImportReport> {
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const startedAt = new Date().toISOString();

    const summaries: ImportSummary[] = new Array(plans.length);
    let nextIndex = 0;
    let done = 0;

    const total = plans.length;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(this.worker(plans, summaries, () => nextIndex++, () => {
        done++;
        const last = summaries[done - 1];
        if (last !== undefined && options.onProgress) {
          options.onProgress(last, done, total);
        }
      }));
    }
    await Promise.all(workers);

    const finishedAt = new Date().toISOString();
    const applied = summaries.filter((s) => s.status === "applied").length;
    const noop = summaries.filter((s) => s.status === "noop").length;
    const failed = summaries.filter((s) => s.status === "failed").length;

    return {
      startedAt,
      finishedAt,
      totalPlans: plans.length,
      summaries,
      applied,
      noop,
      failed,
    };
  }

  private async worker(
    plans: readonly ImportPlan[],
    summaries: ImportSummary[],
    next: () => number,
    onDone: () => void,
  ): Promise<void> {
    while (true) {
      const idx = next();
      if (idx >= plans.length) return;
      const plan = plans[idx]!;
      const t0 = Date.now();
      try {
        const summary = await this.gateway.apply(plan);
        summaries[idx] = { ...summary, durationMs: Date.now() - t0 };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        try {
          await this.gateway.markFailed(plan, err);
        } catch {
          // Best-effort: if marking failure also fails, keep the original error.
        }
        summaries[idx] = {
          manifestKey: plan.deck.manifestKey.toString(),
          deckId: plan.deck.id,
          status: "failed",
          cardsInserted: 0,
          cardsUpdated: 0,
          cardsDeleted: 0,
          cardCount: plan.deck.cards.length,
          error: err.message,
          durationMs: Date.now() - t0,
        };
      }
      onDone();
    }
  }
}
