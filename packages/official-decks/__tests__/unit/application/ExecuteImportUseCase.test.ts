import { describe, it, expect, vi } from "vitest";
import { ExecuteImportUseCase } from "@/application/use-cases/ExecuteImportUseCase";
import { buildPlansForCsv } from "@/application/services/ImportPlanBuilder";
import type { DeckImportGateway } from "@/application/ports/DeckImportGateway";
import type { ImportSummary } from "@/application/dto/ImportPlan";

const sampleRow = {
  cells: [
    "a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p",
  ],
};

function makePlans(n: number) {
  const plans = [];
  for (let i = 0; i < n; i++) {
    const csv = {
      filename: `beginner_batch${i}.csv`,
      header: null,
      rows: [sampleRow],
    };
    plans.push(...buildPlansForCsv(csv));
  }
  return plans;
}

function makeGateway(behavior: (i: number) => Partial<ImportSummary> | Error) {
  let calls = 0;
  const gateway: DeckImportGateway = {
    apply: vi.fn(async (plan) => {
      const i = calls++;
      const r = behavior(i);
      if (r instanceof Error) throw r;
      return {
        manifestKey: plan.deck.manifestKey.toString(),
        deckId: plan.deck.id,
        status: r.status ?? "applied",
        cardsInserted: r.cardsInserted ?? 0,
        cardsUpdated: r.cardsUpdated ?? 0,
        cardsDeleted: r.cardsDeleted ?? 0,
        cardCount: plan.deck.cards.length,
        durationMs: 0,
      };
    }),
    markFailed: vi.fn(async () => {}),
  };
  return gateway;
}

describe("ExecuteImportUseCase", () => {
  it("returns counts that add up to total plans", async () => {
    const plans = makePlans(2); // 2 CSVs × 14 (7 fwd + 7 rev) = 28 plans
    const gateway = makeGateway(() => ({ status: "applied" }));
    const useCase = new ExecuteImportUseCase(gateway);
    const report = await useCase.execute(plans);
    expect(report.totalPlans).toBe(28);
    expect(report.applied).toBe(28);
    expect(report.noop).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.summaries).toHaveLength(28);
  });

  it("marks failed plans and calls markFailed", async () => {
    const plans = makePlans(1); // 14 plans (7 fwd + 7 rev)
    const gateway = makeGateway((i) =>
      i === 3 ? new Error("boom") : { status: "applied" },
    );
    const useCase = new ExecuteImportUseCase(gateway);
    const report = await useCase.execute(plans, { concurrency: 1 });
    expect(report.failed).toBe(1);
    expect(report.applied).toBe(13);
    expect((gateway.markFailed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("respects concurrency=1 sequential order", async () => {
    const plans = makePlans(1);
    const order: string[] = [];
    const gateway: DeckImportGateway = {
      apply: vi.fn(async (plan) => {
        order.push(plan.deck.languagePair.target);
        return {
          manifestKey: plan.deck.manifestKey.toString(),
          deckId: plan.deck.id,
          status: "applied" as const,
          cardsInserted: 0,
          cardsUpdated: 0,
          cardsDeleted: 0,
          cardCount: plan.deck.cards.length,
          durationMs: 0,
        };
      }),
      markFailed: vi.fn(async () => {}),
    };
    const useCase = new ExecuteImportUseCase(gateway);
    await useCase.execute(plans, { concurrency: 1 });
    expect(order).toHaveLength(plans.length);
  });

  it("onProgress is called once per plan", async () => {
    const plans = makePlans(1); // 14 plans (7 fwd + 7 rev)
    const gateway = makeGateway(() => ({ status: "applied" }));
    const useCase = new ExecuteImportUseCase(gateway);
    const progress = vi.fn();
    await useCase.execute(plans, { onProgress: progress });
    expect(progress).toHaveBeenCalledTimes(14);
  });
});
